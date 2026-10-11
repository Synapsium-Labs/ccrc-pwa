// Structural guards for the "one definition, imported everywhere" findings.
//
// Both of these started life as a COMMENT asking the next reader not to copy
// something, and both were copied anyway — `UNCHECKED_PR`'s own docstring said
// "a second copy would drift" and by the time the integration review ran there
// were three. So the guard is a test that reads the sources, in the suite that
// already reaches outside its own package (`module-format.test.ts` walks
// `shared/`, the ccd tests execute `../../ccd/ccd`). A
// comment is a request; a red suite is a mechanism.
//
// These scan TEXT, deliberately, and that is a limitation worth stating: they
// catch the copy that looks like the original, which is the copy people
// actually write. A determined author can evade either one (build the object
// field-by-field, spell the union across a type alias in another file). The
// bar is "a reasonable person adding a fourth copy in the ordinary way is
// stopped before review", not "unforgeable".
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { componentFamily } from './sourceScan.js';
import { fileURLToPath } from 'node:url';
import {
  AUTH_VERDICTS, PR_REASONS, isPrReason, LIFECYCLE_ACTS, LC_ACT_UNKNOWN,
  ASK_STATES, isAskState, ASK_REFUSE_CODES, isAskRefuseCode, ROUTE_WRITABLE_FIELDS, UPDATE_CHANNELS, UPDATE_STATES, UPDATE_PHASES, INSTALL_STATES, PROVENANCE_STATES, AUTO_MODES, NOTIFY_MODES, REQUEST_KINDS, STAMP_READS, NODE_ROLES, NODE_OSES, TAG_FILE_READS,
  SPAWN_VERDICTS,
} from '../../shared/api.js';
import { ARCHIVE_REFUSALS } from '../../shared/api.js';
import { PROVIDER_IDS } from '../../shared/providers.js';
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

/* `prose` and `passage` live at MODULE scope, not inside the one describe that
 * first needed them. They were block-locals 245 lines BELOW the bare
 * `store.slice(store.indexOf(OPEN), store.indexOf(CLOSE))` pair at the
 * abandonment-predicate test — so the cure this file defines was out of reach
 * of the fourth instance of the disease, in the file that defines the cure
 * (D-1439). Hoisting is the fix that also prevents the fifth: any describe here
 * can now anchor a passage without writing the pair again, and writing it again
 * in THIS file would be a second copy of a helper — the exact thing every other
 * assertion in this suite forbids. */
/** A docstring as a reader sees it: leading ` * ` gone, wrapping collapsed —
 *  `coordinator-skill.test.ts`'s `flat()` lesson, applied to a JSDoc block.
 *  Without it, "the ingress route\n   * ONLY" walks past every `toContain`. */
const prose = (t: string): string =>
  t.split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').replace(/\s+/g, ' ');
/** A named docstring slice between two literal anchors, flattened by `prose`.
 *  `ledger-sweep.test.ts`'s `passage()`, copied for its reason as much as
 *  its shape — and copied LATE: the three cases below shipped as a bare
 *  `store.slice(store.indexOf(OPEN), store.indexOf(CLOSE))` pair, which this
 *  file's own header cites the lesson against without applying it (D-1426).
 *
 *  The failure is worse than the `''` the header warns about, and in the
 *  opposite direction. A lost OPENING anchor does yield `''`. A lost CLOSING
 *  one yields `-1`, and `String.slice(a, -1)` means "to length − 1" — so the
 *  docstring silently becomes THE WHOLE REST OF THE FILE, and every
 *  `toContain` below is satisfied by a blob that contains the entire module.
 *  Measured 2026-09-04 by reverting each anchor with a one-word edit to
 *  `store.ts`: the three slices ran to 197,980 / 76,803 / 160,592 chars and
 *  all three cases stayed GREEN. The `> 300` floor was written for the empty
 *  case and MAKES THAT WORSE rather than catching it — a 160KB blob clears a
 *  300-char floor without slowing down. So both anchors are asserted, and the
 *  closing one is searched for AFTER the opening one and must follow it. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = prose(text.slice(a, b));
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(300);
  return out;
};

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
    // Twelve. The tenth was `branch-drift`, added when the PR poller stopped
    // asserting a phase for a workspace whose registry and worktree record name
    // different branches (D-178); the eleventh and twelfth are `unavailable`
    // and `truncated`, split off `error` on 2026-08-26 once a 5xx from
    // api.github.com and a body that stopped mid-stream were measured as two
    // distinct, repeatable faults that `error` was describing with one sentence
    // about a third thing. Every one of them is recognised by the predicate
    // that both validators now use. If `PR_REASONS` were ever hand-written back
    // into an array this still passes — which is why the source scan below
    // exists — but a DERIVED list that has gone out of step with the union is
    // impossible to construct, and that is the point being recorded. The
    // literal count is the ONE thing here that a new member touches,
    // deliberately: it is what makes adding one a decision.
    expect(PR_REASONS).toHaveLength(12);
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
    // because `REASON_TEXT` writes seven of the twelve unquoted — a
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

describe('Stage 3a — one auth verdict vocabulary', () => {
  // The same rule as finding 7 above, applied to a vocabulary that has not had
  // its drift yet — which is the point of writing it on day one rather than
  // after the fourth copy. A file may enumerate all six verdicts ONLY where a
  // `Record<AuthVerdict, …>` makes a missing member a compile error; today the
  // only such file is `shared/api.ts` (the union and `AUTH_VERDICT_MAP`).
  //
  // The login screen's sentences (Task 7) are the expected second holder, and
  // when they land the fix is to type their map `Record<AuthVerdict, string>`
  // and add the file here — exactly what `PrKeycap.tsx` did. Turning this list
  // into a wildcard instead would retire the guard.
  //
  // THEY LANDED. `pwa/src/components/LoginScreen.tsx`'s `VERDICT_TEXT` is that
  // map, typed over the union, so a seventh verdict is a TS2739 in the file that
  // renders the sentences rather than a screen showing a bare slug. The list
  // below GREW BY ONE NAMED FILE — it did not become a pattern — which is what
  // keeps a THIRD copy (the obvious one: a `switch (verdict)` somewhere in the
  // socket path, where the compiler enforces nothing) failing this test.
  //
  // `pwa/src/lib/auth.ts`, which holds the signal these sentences describe, is
  // deliberately NOT here and must not become a holder: it names the two
  // verdicts the status probe can actually produce and no others, because
  // reciting the whole vocabulary in a file that does not render it is exactly
  // the drift this guard is for.
  //
  // Same token form as finding 7's scan — quoted OR as an object key — because
  // `AUTH_VERDICT_MAP` writes four of the six unquoted, and a
  // quoted-literals-only scan would exclude the map by accident rather than by
  // rule, then miss a real copy written the same way.
  const enumerates = (src: string): boolean =>
    AUTH_VERDICTS.every((v) => new RegExp(`(?:'${v}'|(?<![\\w'-])${v}\\s*:)`).test(src));

  it('is enumerated only where the compiler enforces exhaustiveness', () => {
    const holders = ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['pwa/src/components/LoginScreen.tsx', 'shared/api.ts']);
  });

  it('and the login screen’s map is typed over the union, not a bare object', () => {
    // The other half of admitting a second holder: it is admitted BECAUSE the
    // compiler enforces exhaustiveness there. A `Record<string, string>` would
    // satisfy the list above while giving a seventh verdict a silent slug —
    // the `PrKeycap.tsx` assertion below finding 7, for its reason.
    expect(readFileSync(path.join(ccrcRoot, 'pwa/src/components/LoginScreen.tsx'), 'utf8'))
      .toContain('Record<AuthVerdict, string>');
  });

  it('and the scan is looking at something — the six are really in that file', () => {
    // Guards the guard: an `AUTH_VERDICTS` that had gone empty would make
    // `every` vacuously true for EVERY file, turning the assertion above into
    // a list of all 200-odd sources — loud, but for the wrong reason. This
    // fails first, and specifically.
    expect(AUTH_VERDICTS.length).toBe(6);
    expect(enumerates(readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8'))).toBe(true);
    expect(enumerates(readFileSync(path.join(ccrcRoot, 'server/src/prstate.ts'), 'utf8'))).toBe(false);
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

  // Matches any literal naming the script: the `../../ccd/ccd` form
  // ccdWsHelpers.ts holds, and the parts form an author could just as easily
  // reach for — two adjacent path.join arguments that both spell the
  // four-letter script name, the same split style wsaudit.test.ts (one of the
  // original seven) used before the extraction. Two further alternatives once
  // matched the pre-extraction directory's spellings of the path; that
  // directory has not existed since the Stage-1 extraction landed, and its
  // name carries the old box's own name, which the `topology-clean` ratchet
  // now forbids tree-wide — so the dead alternatives are gone and the ratchet
  // itself is what stops that path shape returning (Stage 5, Task 4).
  //
  // Anchored to these exact shapes rather than a bare quoted 'ccd' — this
  // file's server/test tree legitimately quotes 'ccd' for unrelated reasons
  // (ccd-pr-state.test.ts's assertion label, remote-connect and remote-runner
  // stubbing a binary literally named ccd). A looser regex over-matches this
  // file's own comment too, describing the very literal it hunts for.
  // Backticks above, not quotes, keep this comment from being a false
  // positive of its own making — and this paragraph deliberately never writes
  // the two script-name arguments themselves, quoted and adjacent, for the
  // same reason.
  const NAMES_CCD = /['"]\.\.\/\.\.\/ccd\/ccd['"]|['"]ccd['"]\s*,\s*['"]ccd['"]/;

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
  // KeyedQueue inline (`server.ts:330` on origin/main, the tree this diverged
  // from), which FleetWatcher — built two lines EARLIER in index.ts (`:62` vs
  // `:64` on that same tree; `:69` vs `:71` on this one, now that the queue
  // itself hoisted one level further to `index.ts:37`) — had no way to reach.
  // A watcher that built its own would serialise its rename against nothing,
  // and `POST /workspace/reap` (`server.ts:727`) is exactly the write it must
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

describe('one boardHome (board-placement wave 2, Task 1)', () => {
  // `boardProject ?? project` is the wire's ONE fallback (`shared/api.ts`,
  // `FleetSession.boardProject`'s docstring). A second spelling in any
  // consumer is the two-readers drift this suite exists to forbid.
  const CHAIN = /boardProject\s*\?\?/;

  it('is spelled in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => CHAIN.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });
});

describe('one repoLabel (board-placement wave 2, Task 1)', () => {
  // The three-state `ProjectRepoWire` switch. The card row and the session
  // view both render it; a second `state === 'named'` is a second renderer.
  const SWITCH = /\.state === 'named'/;

  it('is asked in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => SWITCH.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
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

  // D-1296: the done-authority six were spelled THREE times — inside
  // MAIL_REJECT_CODES, and as an identical `Extract<MailRejectCode, ...>` in both
  // close.ts and fingerprint.ts. Wave 7's health read needs them at RUNTIME for a
  // SQL `IN (...)`, which would have been a fourth. One array, and the two Extract
  // copies deleted.
  it('enumerates the done-authority family exactly once, and the Extract copies are gone', () => {
    const DEF = /^\s*export const DONE_AUTHORITY_CODES\b/m;
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel))
      .toEqual(['shared/api.ts']);
    // Not "no Extract anywhere" — an Extract over a different union is ordinary.
    // This is the one hand-typed copy of THIS list, anchored on its first member
    // so a reorder cannot slip past.
    const COPY = /Extract<\s*MailRejectCode\s*,[^>]*'stale-tip'/;
    expect(ALL.filter((f) => COPY.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  // D-1319. `runHealth`'s statement (1) reuses `DELIBERATE_CANCEL_ERRORS_SQL`
  // "rather than respelling the two literals", and said in the same breath that
  // `single-definition.test.ts` forbids the second copy. IT DID NOT — this file
  // had never mentioned the pair. Measured before this test existed: a
  // hand-respelled `NOT IN ('run closed','coordinator reclaimed')` in that very
  // query shipped GREEN through the whole suite. A comment is a request; this is
  // the mechanism it claimed to be standing on.
  //
  // Same shape as the terminal-trio scan below, and for the same reason: the
  // shipped list is BUILT by interpolation from the four exported constants, so
  // this scanner sees no literal at all in the real source, and any hand-written
  // SQL list of the SET scores a hit. Any order, because a copy written from
  // memory is as likely to land in any of the four's twenty-four permutations.
  //
  // NOT a bare scan for `'run closed'`: two files quote that string in PROSE
  // (`shared/api.ts`'s lastError vocabulary, `store.ts`'s own
  // `cancelOutstandingDeliveries` docstring), and a guard that fires on a comment
  // explaining the constant is a guard someone deletes.
  it('spells the deliberate-cancel SET once — the constant, never a hand-written SQL list', () => {
    const MEMBERS = '(run closed|coordinator reclaimed|recipient rebound|child workspace reclaimed)';
    const LIST = new RegExp(`\\(\\s*'${MEMBERS}'\\s*(?:,\\s*'${MEMBERS}'\\s*){1,3}\\)`);
    expect(LIST.test("NOT IN ('run closed','coordinator reclaimed') ")).toBe(true);
    expect(LIST.test("NOT IN ( 'coordinator reclaimed', 'run closed' )")).toBe(true);
    expect(LIST.test("NOT IN ('run closed','coordinator reclaimed','recipient rebound','child workspace reclaimed')")).toBe(true);
    expect(LIST.test("NOT IN ('run closed','recipient not in registry')")).toBe(false);

    const holders = ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders, 'a hand-written SQL list of the deliberate-cancel set').toEqual([]);

    // …and the one definition is still built from the four named constants, so
    // "no literal anywhere" cannot be satisfied by deleting the exclusion.
    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(
      /const DELIBERATE_CANCEL_ERRORS_SQL =\s*\n?\s*`\('\$\{MAIL_RUN_CLOSED_ERROR\}','\$\{MAIL_RECLAIM_CANCELLED_ERROR\}','\$\{MAIL_REBIND_SUPERSEDED_ERROR\}','\$\{MAIL_CHILD_RECLAIMED_ERROR\}'\)`/);
    for (const name of ['MAIL_RUN_CLOSED_ERROR', 'MAIL_RECLAIM_CANCELLED_ERROR',
                        'MAIL_REBIND_SUPERSEDED_ERROR', 'MAIL_CHILD_RECLAIMED_ERROR']) {
      const defs = ALL.filter((f) =>
        new RegExp(`^\\s*export const ${name}\\b`, 'm').test(readFileSync(f, 'utf8'))).map(rel);
      expect(defs, name).toEqual(['server/src/coord/store.ts']);
    }
    // The readers that must keep reaching the constant — "the copies are
    // gone" is also satisfied by deleting the exclusion from all of them.
    expect((store.match(/NOT IN \$\{DELIBERATE_CANCEL_ERRORS_SQL\}/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  // The SECOND half of the same rule, and the reason it needs its own case: the
  // abandonment predicate is about to have two readers — the mailbox
  // (`outstandingMailFor`) and the reclaim's re-queue — and a respelling in
  // either is invisible to the deliberate-cancel pin above, which watches only
  // the two `lastError` literals. This watches the run-state clause, the half a
  // re-queue is most likely to retype because its alias (`rr`) is the caller's
  // own join.
  //
  // NO SELF-MATCH RISK, stated so the next author does not "fix" a hazard that
  // is not here: this case reads `server/src/coord/store.ts` ALONE, never `ALL`
  // and never itself, and `ROOTS` (:33-38) does not include `server/test`. The
  // needles below can therefore be written whole.
  it('spells the abandonment predicate ONCE — the constant, never a second copy of its clauses', () => {
    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');

    // The premise, established rather than assumed: this needle really is the
    // clause, and it really is distinct from the twelve `runs`-row predicates in
    // the same file (those read `r.state`/`state`, never the mail join's `rr`).
    // Since design 2026-09-14 §7.1 (D-2794/D-2800) the run-state half is no
    // longer a hand-written pair but L0's `TERMINAL_RUN_STATES_SQL` — updated
    // here rather than left pinning the literal the sweep just retired.
    const CLAUSE = "COALESCE(rr.state, '') NOT IN ${TERMINAL_RUN_STATES_SQL}";
    expect(store, 'the abandonment clause is not in store.ts at all').toContain(CLAUSE);
    expect(store.split(CLAUSE).length - 1,
      'the abandonment run-state clause is written more than once').toBe(1);

    // …and the one spelling lives in a named constant that the read predicate is
    // COMPOSED from, so "written once" cannot be satisfied by deleting a reader.
    expect(store, 'ABANDONED_PARK_SQL is not defined').toMatch(/^const ABANDONED_PARK_SQL =/m);
    expect(store).toMatch(
      /const OUTSTANDING_OR_ABANDONED_SQL =\s*`\(d\.state IN \$\{OUTSTANDING_STATES_SQL\} OR \$\{ABANDONED_PARK_SQL\}\)`;/);

    // THE PROSE HALF. The docstring one screen up describes the composed
    // predicate; after the split it may not still call itself ONE definition.
    // The premise is established first — there really are two now — so this is
    // not an absence assertion whose fixture cannot produce the presence.
    const defs = (store.match(/^const (?:ABANDONED_PARK_SQL|OUTSTANDING_OR_ABANDONED_SQL)\b/gm) ?? []).length;
    expect(defs, 'the two predicate definitions are not both present').toBe(2);
    // Named apart from the sibling passage on the SAME anchors 250 lines below:
    // two call sites sharing one name make an anchor failure unattributable.
    const doc = passage('the abandonment-predicate docstring', store,
      ' * The READ-side "still needs a human', 'const OUTSTANDING_OR_ABANDONED_SQL');
    expect(doc, 'the predicate docstring still calls the composed predicate one SQL definition')
      .not.toContain('in this one SQL definition');
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

  // ── D-2546: the hold route's own reason budget ──────────────────────────
  //
  // Same shape as the pair above, and here for the same reason: a cap with two
  // homes is two thresholds nothing forces to agree. The SECOND assertion is
  // the one that earns this its own block — 512 is deliberately the same
  // number as `LC_REASON_MAX_BYTES` and deliberately NOT an alias of it
  // (`LEDGER_TITLE_MAX_BYTES`'s stated argument: tying two seams' caps
  // together lets a change to one silently rewrite the other's refusal
  // threshold), so "one definition" here must mean an own-value literal, not
  // a re-export of the neighbour that happens to hold the same integer.
  it('defines HOLD_ROUTE_REASON_MAX_BYTES exactly once, in shared/, and not as an alias', () => {
    const hits = ALL.filter((f) =>
      /^\s*export const HOLD_ROUTE_REASON_MAX_BYTES\b/m.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual(['shared/api.ts']);
    const src = readFileSync(hits[0]!, 'utf8');
    expect(/export const HOLD_ROUTE_REASON_MAX_BYTES\s*=\s*\d+\s*;/.test(src),
      'HOLD_ROUTE_REASON_MAX_BYTES must hold its own literal, never LC_REASON_MAX_BYTES').toBe(true);
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

  // D-1404. Same shape and the same reason as the
  // deliberate-cancel scan at the top of this describe (D-1319) and the
  // terminal-trio scan above: the shipped SQL is BUILT by `join`, so this
  // scanner sees no literal at all in the real source, and any hand-written SQL
  // list of the delivery terminal pair scores a hit. Either order, because a
  // copy written from memory is as likely to be the other way round.
  //
  // Measured before this test existed (2026-09-02, 5e9f650d): the pair was
  // spelled six times in `store.ts`'s own SQL and seven more times in its
  // docstrings, and the whole suite was green. Those prose copies are why the
  // SQL rewrite must also rewrite the comments — unlike the deliberate-cancel
  // case the prose here spells the SQL FORM itself, so an SQL-shaped regex hits
  // a comment explaining the constant.
  //
  // ANCHORED ON `(` AND `)` ONLY, never `[`. The trio scan above can use
  // `[[(]` because its own definition lives in a file it EXPECTS to see in
  // `holders`; this one asserts `holders` is EMPTY, and the definition is
  // `['acked', 'rejected']` — bracketed. A `[[(]` here would match the
  // definition itself and the test could never pass. The cost is stated
  // honestly: a hand-written JS ARRAY copy under another name is out of this
  // scanner's reach, exactly as this file's own header paragraph says
  // ("A determined author can evade either one").
  it('spells the delivery terminal pair ONCE — TERMINAL_DELIVERY_STATES, never a hand-written SQL list', () => {
    // This scan reads ALL, and ALL is built from ROOTS — which does NOT include
    // `server/test`. That is what makes it safe for this test to spell the
    // forbidden literal in its own self-checks below, and it is measured here
    // rather than assumed: adding `server/test` to ROOTS would turn every
    // literal-scan in this file into a guard that matches its own source.
    expect(ALL.map(rel)).not.toContain('server/test/single-definition.test.ts');

    const PAIR = /\(\s*'(acked|rejected)'\s*,\s*'(acked|rejected)'\s*\)/;
    // The premise, established inside the test rather than assumed: without
    // these three lines the assertion below is satisfied by a regex that
    // matches nothing.
    expect(PAIR.test("NOT IN ('acked','rejected') ")).toBe(true);
    expect(PAIR.test("NOT IN ( 'rejected', 'acked' )")).toBe(true);
    expect(PAIR.test("IN ('queued','delivered')")).toBe(false);

    const holders = ALL.filter((f) => PAIR.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders, 'a hand-written SQL list of the delivery terminal pair').toEqual([]);

    // …and the one definition still exists and is still what the guards are
    // built from, so "no literal anywhere" cannot be satisfied by deleting
    // every guard instead.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const TERMINAL_DELIVERY_STATES = \['acked', 'rejected'\] as const/);
    const defs = ALL.filter((f) =>
      /^\s*export const TERMINAL_DELIVERY_STATES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(defs, 'TERMINAL_DELIVERY_STATES').toEqual(['shared/api.ts']);

    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(
      /const TERMINAL_DELIVERY_SQL =\s*\n?\s*`\('\$\{TERMINAL_DELIVERY_STATES\.join\("','"\)\}'\)`/);

    // THE FLOOR IS COUNTED OVER CODE, NOT PROSE, and that is the whole point of
    // it. This task rewrites SEVEN DOCSTRING lines to read
    // `NOT IN ${TERMINAL_DELIVERY_SQL}` as well, so a count over the raw file
    // would sit at 13 and stay above 6 with every real guard deleted — an
    // anti-vacuity check that is itself vacuous. Comment lines are stripped
    // first, and the strip is proved to work on a sentence that only exists
    // inside a comment.
    const code = store.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
    expect(store, 'the sentinel is gone from store.ts — pick another comment-only phrase')
      .toContain('the same guard every other');
    expect(code, 'the comment strip did not strip comments').not.toContain('the same guard every other');
    // Six negative-form guards at 5e9f650d (2026-09-02), as a FLOOR so a
    // seventh writer raises it rather than breaking it.
    expect((code.match(/NOT IN \$\{TERMINAL_DELIVERY_SQL\}/g) ?? []).length)
      .toBeGreaterThanOrEqual(6);
  });

  // …and the SAME pair in its JS shape, which the SQL-anchored regex above is
  // structurally incapable of seeing. Two scans, not one, because the two
  // copies do not look alike: `store.ts` wrote an SQL list, `MailStrip.tsx`
  // wrote a disjunction, and a single regex that caught both would have to be
  // loose enough to fire on prose (D-1404).
  it('spells the delivery terminal pair ONCE in JS too — no hand-written === disjunction', () => {
    const DISJ = /===\s*'(acked|rejected)'[^\n]*\|\|[^\n]*===\s*'(acked|rejected)'/;
    // The premise, established here: both orders are recognised, and a
    // SINGLE-member test — which is not a copy of the pair and is a legitimate
    // thing to write (`statusArm`, MailStrip.tsx: `state === 'rejected'` alone)
    // — is not.
    expect(DISJ.test("if (item.state === 'acked' || item.state === 'rejected') return null;")).toBe(true);
    expect(DISJ.test("x.state === 'rejected' || x.state === 'acked'")).toBe(true);
    expect(DISJ.test("if (item.state === 'rejected') return 'abandoned';")).toBe(false);

    const holders = ALL.filter((f) => DISJ.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders, 'a hand-written JS disjunction of the delivery terminal pair').toEqual([]);

    // The client really does still EXCLUDE the pair — "no disjunction anywhere"
    // is also satisfied by deleting the test entirely, which would put a gate
    // line on an acked row. Asserted as the CALL SHAPE, not as the identifier:
    // the identifier also appears in this file's own new docstring paragraph,
    // so a `toContain('TERMINAL_DELIVERY_STATES')` would be satisfied by the
    // comment alone and would pass with the GUARD deleted — the single
    // `.includes(item.state)` early-return matched just below. Named by its
    // call shape rather than its line: this sentence used to say "line 167",
    // and the very commit that wrote that number had already pushed the guard
    // off it.
    const strip = readFileSync(path.join(ccrcRoot, 'ui/src/components/mail-strip.tsx'), 'utf8');
    expect(strip).toMatch(
      /if \(\(TERMINAL_DELIVERY_STATES as readonly string\[\]\)\.includes\(item\.state\)\) return null;/);
  });

  it('spells the run-state lists ONCE — ACTIVE_RUN_STATES / TERMINAL_RUN_STATES, never a hand-written SQL list (D-2800)', () => {
    expect(ALL.map(rel)).not.toContain('server/test/single-definition.test.ts');

    // Adjacent quoted pairs/triples of the two lists, in either order, with any
    // spacing — the shapes a copy actually takes in SQL or JS.
    const TERMINAL_PAIR = /\(\s*'(done|failed)'\s*,\s*'(done|failed)'\s*\)/;
    const ACTIVE_LIST = /\(\s*'(dispatched|working|unknown)'\s*,\s*'(dispatched|working|unknown)'\s*(?:,\s*'(dispatched|working|unknown)'\s*)?\)/;
    expect(TERMINAL_PAIR.test("NOT IN ('done','failed')")).toBe(true);
    expect(TERMINAL_PAIR.test("IN ( 'failed', 'done' )")).toBe(true);
    expect(ACTIVE_LIST.test("IN ('dispatched','working','unknown')")).toBe(true);
    expect(ACTIVE_LIST.test("IN ('queued','delivered')")).toBe(false);

    const holders = ALL.filter((f) => {
      const t = readFileSync(f, 'utf8');
      return TERMINAL_PAIR.test(t) || ACTIVE_LIST.test(t);
    }).map(rel).sort();
    // `schema.ts` is exempt for FROZEN migration strings only; nothing else may hold the literal.
    expect(holders.filter((h) => h !== 'server/src/coord/schema.ts'),
      'a hand-written SQL list of the run-state pair/triple').toEqual([]);

    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(/export const ACTIVE_RUN_STATES = \['dispatched', 'working', 'unknown'\] as const/);
    expect(api).toMatch(/export const TERMINAL_RUN_STATES = \['done', 'failed'\] as const/);
    for (const name of ['ACTIVE_RUN_STATES', 'IDLE_RUN_STATES', 'TERMINAL_RUN_STATES']) {
      const defs = ALL.filter((f) =>
        new RegExp(`^\\s*(?:export )?const ${name}\\b`, 'm').test(readFileSync(f, 'utf8'))).map(rel);
      expect(defs, name).toEqual(['shared/api.ts']);
    }

    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(/const INACTIVE_RUN_STATES_SQL =\s*\n?\s*`\('\$\{\[\.\.\.IDLE_RUN_STATES, \.\.\.TERMINAL_RUN_STATES\]\.join\("','"\)\}'\)`/);
    expect(store).toMatch(/const TERMINAL_RUN_STATES_SQL =\s*\n?\s*`\('\$\{TERMINAL_RUN_STATES\.join\("','"\)\}'\)`/);
    expect(store, 'capsUsage no longer reads the inactive fragment')
      .toMatch(/dispatchedAt IS NOT NULL AND state NOT IN \$\{INACTIVE_RUN_STATES_SQL\}/);
    // The sweep's floor: at least six `TERMINAL_RUN_STATES_SQL` consumers in store.ts (measured in Task 1 step 1).
    expect((store.match(/\$\{TERMINAL_RUN_STATES_SQL\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  // D-289 (was D-B4-16): no L1 file holds a database handle. `architecture:78-81` puts
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
      // `REACH` itself is module-scope, just below this describe: the update ring at the end of this file reads it too.
      for (const f of coordFiles) {
        if (HANDLE_HOLDERS.has(path.basename(f))) continue;
        const src = readFileSync(f, 'utf8');
        expect(REACH.test(src),
          `${rel(f)} names a database handle on a coord/store receiver`).toBe(false);
      }
    });
  });
});
const REACH = /\b(?:coord|store)\.db\s*[.,)]/;
// ── program-leverage wave 8 ────────────────────────────────────────────────
//
// A docstring that names its own callers is a SECOND COPY of a fact the code
// already states, and this file exists because two copies of one fact drift.
// Same corpus, same argument as the header above — "a comment is a request; a
// red suite is a mechanism" — one level up from a duplicated VALUE to a
// duplicated CLAIM. Both cases derive the fact from `server/src` and check the
// prose against it; neither reads itself, and `ROOTS` (:33-38) contains no test
// directory, so no needle here can match its own source line.
describe('store.ts docstrings that describe their own callers', () => {
  const STORE = path.join(ccrcRoot, 'server/src/coord/store.ts');
  /** Source with every comment LINE removed, so a sentence about a call is
   *  never counted as a call. */
  const codeOnly = (t: string): string =>
    t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

  it('the predicate docstring names the join kinds its callers actually carry', () => {
    const store = readFileSync(STORE, 'utf8');
    const code = codeOnly(store);
    const left = (code.match(/LEFT JOIN runs rr\b/g) ?? []).length;
    const inner = (code.match(/(?<!LEFT )JOIN runs rr\b/g) ?? []).length;
    // BOTH premises, established before the claim is judged. Without the second
    // one this assertion would be demanding a word about a caller that does not
    // exist.
    expect(left, 'no LEFT-JOIN caller of the mail→run edge — nothing to contrast').toBeGreaterThan(0);
    expect(inner, 'no INNER-JOIN caller of the mail→run edge — the sentence under test is not yet false')
      .toBeGreaterThan(0);

    const doc = passage('the predicate docstring', store,
      ' * The READ-side "still needs a human', 'const OUTSTANDING_OR_ABANDONED_SQL');
    expect(doc,
      'the predicate docstring names one join kind while its callers carry two').toContain('INNER');
  });

  it('setDeliveryEnvelope names every caller it has, derived from the tree', () => {
    const store = readFileSync(STORE, 'utf8');
    const doc = passage("setDeliveryEnvelope's docstring", store,
      '   * Overwrites a delivery', '  setDeliveryEnvelope(');

    // The claim that was false for two builds. Split at the call site so this
    // needle can never match a scan of this file (`ALL` does not reach
    // `server/test`, but the idiom is cheap and the next scanner may).
    expect(doc, 'the docstring still says the ingress route is its only caller')
      .not.toContain('used by the ingress ' + 'route ONLY');

    const outside = ALL.filter((f) =>
      rel(f).startsWith('server/src/') && rel(f) !== 'server/src/coord/store.ts'
      && /\.setDeliveryEnvelope\(/.test(codeOnly(readFileSync(f, 'utf8'))));
    expect(outside.length, 'the scan found no caller outside store.ts — nothing to check the prose against')
      .toBeGreaterThanOrEqual(2);
    for (const f of outside) {
      expect(doc, `the docstring does not name ${rel(f)}`).toContain(path.basename(rel(f)));
    }

    expect(/\bthis\.setDeliveryEnvelope\(/.test(codeOnly(store)),
      'no in-file caller of setDeliveryEnvelope — this half has nothing to check').toBe(true);
    expect(doc, 'the docstring does not name the in-file caller')
      .toContain('requeueAbandonedMail');
  });

  /** Statement keywords that wear a declaration's shape at two-space indent. A
   *  `  if (` inside a top-level function body would otherwise be recorded as
   *  the holder of every line under it. */
  const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else',
    'try', 'new', 'typeof', 'await', 'throw', 'case', 'const', 'let', 'var', 'function', 'class',
    'delete', 'in', 'of', 'yield', 'void', 'super', 'this']);

  /** Every `${NAME}` interpolation of `needle` in `src`, named by the
   *  declaration it sits in — a class member, or a top-level `const`. Comment
   *  lines go first (`codeOnly`), so a SENTENCE about a predicate is never
   *  counted as a use of it, which matters more here than anywhere else in this
   *  file: the prose under test is itself full of the needle's name. */
  const holdersOf = (src: string, needle: string): string[] => {
    const out: string[] = [];
    let decl = '';
    for (const line of codeOnly(src).split('\n')) {
      const m = /^ {2}(?:private |public |protected )?(?:static )?(?:async )?([A-Za-z_]\w*)\s*[(<]/
        .exec(line) ?? /^(?:export )?const ([A-Za-z_]\w*)\s*=/.exec(line);
      if (m && !JS_KEYWORDS.has(m[1]!)) decl = m[1]!;
      if (line.includes(needle)) out.push(decl);
    }
    return [...new Set(out)];
  };

  it("the re-queue's reader walk names every holder the file actually has", () => {
    // D-1426. The walk shipped hand-typed and claimed "all four" — while the
    // narrow predicate had NINE holders, one of the four named (`dueDeliveries`)
    // spells its two states out and is not a holder at all, and the omitted one
    // was `runHealth`, the single reader whose OUTPUT the fifth arm moves. So
    // the list is derived from the same source it describes, which is the only
    // form of that claim a later edit cannot quietly falsify.
    const store = readFileSync(STORE, 'utf8');
    const doc = passage("the re-queue's reader walk", store,
      '   * THE READERS OF BOTH PREDICATES WERE WALKED',
      '   * BOUNDED by the role-addressed reports');

    const narrow = holdersOf(store, '${OUTSTANDING_STATES' + '_SQL}');
    const wide = holdersOf(store, '${OUTSTANDING_OR_ABANDONED' + '_SQL}');
    // Anti-vacuity floors, not counts — a count here would be the second copy
    // this file exists to forbid. They exist so a scanner whose regex stopped
    // matching cannot pass by finding nothing to check.
    expect(narrow.length, 'no holder of the narrow predicate — the scan is broken')
      .toBeGreaterThanOrEqual(6);
    expect(wide.length, 'no holder of the composed predicate — the scan is broken')
      .toBeGreaterThanOrEqual(3);

    // The derived set is the authority and the prose is what gets checked
    // against it, never the other way round: a tenth holder reds here until the
    // walk admits it.
    for (const name of [...new Set([...narrow, ...wide])]) {
      expect(doc, `the reader walk does not name ${name}`).toContain(name);
    }
    // The omission itself, called out by name, so the regression that started
    // this has a line of its own rather than only a derived one.
    expect(narrow, 'runHealth stopped reading the narrow predicate').toContain('runHealth');
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

// The provider table, §4.2. This describe is the `.tsx?` half; the other half —
// the one that can see a copy in a `.mjs` — is `server/test/providers.test.ts`,
// because `sources()` above (:40-57) filters `/\.tsx?$/` at :54 and has never
// seen a `.mjs`, a `.d.mts` or a bash script (D-76, and `source-bytes.test.ts:30-36`
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
    // measured 2026-09-07 over the four ROOTS: `server/src/config.ts:310`
    // (`host: env.CCRC_HOST || '127.0.0.1'`), `server/src/auth/webauthn.ts:342`
    // (`url.hostname === '127.0.0.1'`), `agent/src/index.ts:25` and
    // `agent/src/server.ts:712` (`rawOpts.host ?? '127.0.0.1'`). Pinning the
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

// ── the bash side of "one definition", shared by the scans below ─────────
// Two describes read the same two trees now (the build stamp, and stage 2e's
// remote-control flag), so the walk lives here rather than inside either — a
// second copy of the scanner, in the file whose whole subject is second
// copies, would be the joke this suite exists to prevent.
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
// `install.sh` is not under any bash ROOT — it sits at the repo top, because
// that is where `curl … | bash` fetches it from. It was therefore outside this
// corpus entirely, so every "spelled once" rule below had been blind to the
// one script a stranger runs first. Folded in globally rather than per-rule:
// the seven pre-existing rules (build.json's two readers, `.ccrc/remote-control`,
// `.ccrc/exposure.env`, `.ccrc/Caddyfile`, `/etc/caddy/Caddyfile`, `ccrc-ddns`,
// the `KillMode=process` sweep) all want to see it too. `.filter(existsSync)`
// so a checkout without it fails the liveness row below, not every rule.
const bashExtra = [path.join(ccrcRoot, 'install.sh')].filter((f) => existsSync(f));
const BASH = [...bashRoots.flatMap(bashFiles), ...bashExtra];
/** One notion of a bash comment line, shared by every scan in this file that drops them (codeLines, the USAGE_PROSE describe's code()). */
const isBashComment = (l: string): boolean => l.trim().startsWith('#');
/** A bash line that is not a comment. Either path is discussed in prose all
 *  over these tools; only an actual line of shell is a reader or a writer. */
const codeLines = (f: string): string[] =>
  readFileSync(f, 'utf8').split('\n').filter((l) => !isBashComment(l));
const holdersOf = (needle: string): string[] =>
  BASH.filter((f) => codeLines(f).some((l) => l.includes(needle))).map(rel).sort();

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
    // for. `server/test/ccrc-install.test.ts` ("writes the stamp through
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
  // FIVE paths — measured 2026-09-08 by counting this describe's own
  // writer/reader rows below (the models directory, the catalogue, the
  // registry, the LiteLLM config, the ownership whitelist) — each with a
  // writer and a set of readers, and the whole reason to register them here
  // is that they cross LANGUAGES: the catalogue is written by bash-and-python
  // and read by TypeScript; the TSV is written by node and read (from Plan 2)
  // by bash; the effort map is written by node and read by python in another
  // repository. None of those pairs can share a constant, so agreement has to
  // be a red suite instead.
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

  it('the LiteLLM config path is spelled once, in one tool, through one helper', () => {
    // `ccgpt` (another repository) reads the same path from its own
    // `${CCGPT_CONFIG:-…}` default, which is why the helper here honours the
    // same override rather than hardcoding the default: two tools, one file,
    // and only one of them is in this repo to be pinned.
    expect(holdersOf('.handoff/litellm-config.yaml')).toEqual(['ccd/ccrc']);
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    // D-3482: the helper grew a codex-lane arm (an id argument),
    // so the one spelling is now its no-argument line — still one line, and
    // still inside `_models_litellm_path`, which the second pin binds.
    expect(code.filter((l) => l.includes('.handoff/litellm-config.yaml'))).toEqual([
      '  printf \'%s\' "${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}"',
    ]);
    const helper = /^_models_litellm_path\(\) \{[^\n]*\n([\s\S]*?)\n\}$/m
      .exec(readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8'));
    expect(helper, 'ccd/ccrc still defines _models_litellm_path as a block').toBeTruthy();
    expect(helper![1]!.split('\n'))
      .toContain('  printf \'%s\' "${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}"');
  });

  it('the ownership whitelist is read by exactly one thing in this repo', () => {
    // `handoff-proxy` and `claude-glm` read it too — in the monorepo, which
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
  //     (`ccrc-doctor.test.ts`'s `tableNames()` does exactly that), so a
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
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom. `watch.ts:194` holds
    // a second literal ON PURPOSE (`sweepMail` uses it; importing the
    // `rundefs.ts` copy into that scope as well would be a redeclaration,
    // TS2451), and `rundefs.ts`'s own docstring carries the argument for the
    // split. So the expected shape here is a NAMED LIST rather than one file —
    // and any new holder still fails.
    //
    // Two of the five are refusal codes, not marker literals: `'mail-disabled'` is also
    // a `RunRefuseCode` member, so `shared/api.ts` (the vocabulary) and
    // `coord/dispatch.ts` (the refusal that uses it) spell the same characters
    // for a different reason. Listing them here is the honest shape — a scan
    // that pretended they were copies would be describing the tree wrongly.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'mail-disabled'")).map(rel).sort();
    expect(holders).toEqual([
      'server/src/coord/dispatch.ts',   // the refusal CODE
      'server/src/coord/rundefs.ts', 'server/src/coord/stall.ts', // the marker literal (definition); stall.ts: the hold named for the marker it honours
      'server/src/watch.ts',            // the marker literal (module-local, on purpose)
      'shared/api.ts',                  // the refusal-code vocabulary
    ]);
  });

  it('watch.ts reaches the pause marker through the shared constant, never a copy', () => {
    // Not just "no second literal" — that is satisfied by deleting the emitter.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8');
    expect(src).toContain('COORDINATOR_PAUSE_MARKER');
    // The property is "reached through the shared constant, FROM that module",
    // not "that import line names exactly one symbol". Widened in
    // program-leverage wave 4, which imports `MAIL_ROLE_IDS` from the same
    // place: the alternative was a second import line from one module purely to
    // satisfy a regex, which is a contortion, not a guard. The `\b` anchors keep
    // it from matching a longer name that merely contains this one.
    expect(src).toMatch(/import \{[^}]*\bCOORDINATOR_PAUSE_MARKER\b[^}]*\} from '\.\/coord\/rundefs\.js'/);
  });
});

// — Child-reclamation wave 4: the reclaim switch's file name —
describe("child-reclamation wave 4 — one 'reclaim-paused' literal", () => {
  it("'reclaim-paused' is a literal in exactly one source file", () => {
    // `RECLAIM_PAUSE_MARKER` (`server/src/coord/rundefs.ts`) is the ONE
    // definition. A second literal is how the banner and the sweep would come
    // to disagree about what "paused" means — one reading a name the other
    // never checks, with the deleting side the one that is wrong.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'reclaim-paused'")).map(rel);
    expect(holders).toEqual(['server/src/coord/rundefs.ts']);
  });

  it('watch.ts reaches the reclaim marker through the shared constant, never a copy', () => {
    // Not just "no second literal" — that is satisfied by deleting the reader.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8');
    expect(src).toContain('names.includes(RECLAIM_PAUSE_MARKER)');
    expect(src).toMatch(/import \{[^}]*\bRECLAIM_PAUSE_MARKER\b[^}]*\} from '\.\/coord\/rundefs\.js'/);
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

  it('the fence spelling survives NOWHERE else — the named gap is closed', () => {
    // THE EXCLUSION IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom this file already
    // uses for `'mail-disabled'` one describe up.
    //
    // `inject/send.ts` (`isMailResidue`) used to test a DRAFT for a stranded
    // envelope opener with a hand-spelled copy of the info string, recorded
    // here as a named gap with an instruction attached: whoever next had a
    // reason to edit that file should import `MAIL_ENVELOPE_FENCE` and shorten
    // this list to `shared/api.ts` alone. Build 8's wave 4 had five reasons
    // and took the invitation, so the list is one entry again and the
    // exclusion it documented is gone rather than merely smaller.
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

  it('spells the spawn members nowhere else — no second free-standing list of them', () => {
    // `SessionLine.tsx`'s `SPAWN_WORD` is a PRESENTATIONAL map keyed BY the type
    // (`Record<SpawnVerdict, string | null>`, which the compiler keeps total), not
    // a second enumeration — so it holds the member names as KEYS and is exempt by
    // being typed. What this forbids is a free-standing list.
    //
    // BUILT FROM `SPAWN_VERDICTS`, in any order, the way the deliberate-cancel
    // SET scan above is. The literal this replaced spelled the six members the
    // union had when it was written, in that order — so once `narrow` joined,
    // the one list it could still see was the stale one, and a copy of the
    // union as it now stands passed. A list holding all but one member counts:
    // a copy written from memory is as likely to drop one as to reorder them.
    const M = `(?:${SPAWN_VERDICTS.join('|')})`;
    const LIST = new RegExp(`\\[\\s*'${M}'\\s*(?:,\\s*'${M}'\\s*){${SPAWN_VERDICTS.length - 2},}\\]`);
    expect(LIST.test(`['${[...SPAWN_VERDICTS].reverse().join("', '")}']`)).toBe(true);
    expect(LIST.test(`['${SPAWN_VERDICTS.slice(1).join("','")}']`)).toBe(true);
    expect(LIST.test("['ready', 'login', 'blocked']")).toBe(false);
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

  // program-leverage wave 2 (F2). `SkillState` joins this family on the same
  // terms: one type, one presentational `Record` keyed BY the type (which the
  // compiler keeps total), and a runtime list DERIVED from that map's keys.
  // The fold ruling for this wave is what makes single-definition load-bearing
  // here rather than merely tidy — the adjacent graphify lane is building its
  // own skill-presence machinery, and the two lanes converge on this
  // vocabulary. A second spelling anywhere is the drift that ruling forbids.
  it('defines SkillState, SKILL_STATE_MAP and SKILL_STATES exactly once, in shared/', () => {
    oneDefinition(/^\s*export type SkillState\b/m, 'SkillState');
    oneDefinition(/^\s*export const SKILL_STATE_MAP\b/m, 'SKILL_STATE_MAP');
    oneDefinition(/^\s*export const SKILL_STATES\b/m, 'SKILL_STATES');
  });

  it('DERIVES SKILL_STATES from its map — never a hand-written array beside the type', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SKILL_STATES: readonly SkillState\[\] =\s*\n?\s*Object\.keys\(SKILL_STATE_MAP\)/);
    expect(api, 'SKILL_STATES is hand-typed as a literal array — derive it from SKILL_STATE_MAP')
      .not.toMatch(/SKILL_STATES[^=]*=\s*\[/);
  });

  it('spells the three skill-state members nowhere else — no second copy of the words', () => {
    // A free-standing list is how a PWA badge or an agent-side probe silently
    // drifts from the wire. The Record in shared/api.ts is keyed by the type,
    // so it is not an enumeration and is not matched here.
    const LIST = /\[\s*'present',\s*'absent',\s*'unmeasurable'\s*\]/;
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('does not respell io.ts read-failure pair as the skill vocabulary', () => {
    // SkillState deliberately says `unmeasurable`, not `unreadable`. The two
    // vocabularies answer different questions — one read's failure vs a
    // conclusion drawn from a read that may never have happened — and the
    // bespoke assertion below already pins the PAIR to server/src/io.ts alone.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).not.toMatch(/'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'/);
  });

  // program-leverage wave 3 (F3). Four readiness vocabularies join this family
  // on the same terms `SkillState` did: one type, one presentational `Record`
  // keyed BY the type, a runtime list DERIVED from that map's keys. They are
  // pinned here rather than in a describe of their own because the family is
  // the thing being protected — a fifth vocabulary added next to these should
  // trip the same three assertions without anyone remembering to write them.
  it('defines the four readiness vocabularies exactly once, in shared/', () => {
    oneDefinition(/^\s*export type FloorState\b/m, 'FloorState');
    oneDefinition(/^\s*export const FLOOR_STATE_MAP\b/m, 'FLOOR_STATE_MAP');
    oneDefinition(/^\s*export type TokenState\b/m, 'TokenState');
    oneDefinition(/^\s*export const TOKEN_STATE_MAP\b/m, 'TOKEN_STATE_MAP');
    oneDefinition(/^\s*export type CoordDbState\b/m, 'CoordDbState');
    oneDefinition(/^\s*export const COORD_DB_STATE_MAP\b/m, 'COORD_DB_STATE_MAP');
    oneDefinition(/^\s*export type ReadyVerdict\b/m, 'ReadyVerdict');
    oneDefinition(/^\s*export const READY_VERDICT_MAP\b/m, 'READY_VERDICT_MAP');
  });

  it('DERIVES every readiness member list from its map', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    for (const [list, map] of [
      ['FLOOR_STATES', 'FLOOR_STATE_MAP'], ['TOKEN_STATES', 'TOKEN_STATE_MAP'],
      ['COORD_DB_STATES', 'COORD_DB_STATE_MAP'], ['READY_VERDICTS', 'READY_VERDICT_MAP'],
    ] as const) {
      expect(api, `${list} is not derived from ${map}`).toMatch(
        new RegExp(`export const ${list}[^=]*=\\s*\\n?\\s*Object\\.keys\\(${map}\\)`));
      expect(api, `${list} is hand-typed as a literal array — derive it from ${map}`)
        .not.toMatch(new RegExp(`${list}[^=]*=\\s*\\[`));
    }
  });

  it('the projects wire row is declared once, and no inline twin survives', () => {
    // D-1028, and then D-1028's own gap. The shape was spelled THREE times —
    // `lifecycle.ts`'s return type, a local `interface Project` in the sheet,
    // and this generic in `pwa/src/lib/api.ts` — the last of which sits two
    // lines under a comment warning that "a field added in Stage 2a is exactly
    // the kind of addition that lands in two of three copies". F3's
    // `readiness` was that field: it typechecks against the twin (the property
    // is optional), so nothing failed — the declared type simply went on
    // denying a field the server was already sending. Caught in self-review,
    // not by a test, which is why this one exists.
    oneDefinition(/^\s*export interface ProjectRow\b/m, 'ProjectRow');
    // PREFIX-LESS, deliberately (fix round 1, minor 3). The first version of
    // this scan keyed on the INLINE GENERIC spelling (`projects: { name:
    // string; workdir: string }[]`) and so was blind to the other way the twin
    // is written — a local `interface Project { name; workdir }` — which was
    // LIVE in the tree at the time, in NewSessionSheet.tsx, with this suite
    // green. A fingerprint that only catches the copy you already fixed is not
    // a guard. This matches the FIELD PAIR however it is spelled, and the one
    // legal holder is the declaration itself.
    const TWIN = /\bname:\s*string;\s*\n?\s*workdir:\s*string\b/;
    expect(
      ALL.filter((f) => TWIN.test(readFileSync(f, 'utf8'))).map(rel),
      'a twin of the projects row — import ProjectRow from shared/api instead',
    ).toEqual(['shared/api.ts']);
  });

  it('the readiness verdict is DERIVED in one place, never recomputed by a consumer', () => {
    // `readyVerdict` is L0 and pure so the PWA renders the server's answer
    // rather than folding five fields a second time. A second fold is how the
    // badge and the board come to disagree about the same box.
    oneDefinition(/^\s*export function readyVerdict\b/m, 'readyVerdict');
    oneDefinition(/^\s*export function foldSkillStates\b/m, 'foldSkillStates');
  });

  describe('AskState', () => {
    const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    const oneDefinition = (name: string): string[] =>
      ALL.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, 'utf8'))).map(rel);

    it('is spelled once, in shared/api.ts', () => {
      expect(oneDefinition('ASK_STATE_MAP')).toEqual(['shared/api.ts']);
      expect(oneDefinition('ASK_STATES')).toEqual(['shared/api.ts']);
    });

    it('derives its runtime list from the map, never a second array', () => {
      const src = read('shared/api.ts');
      expect(src).not.toMatch(/ASK_STATES[^=]*=\s*\[/);
    });

    it('round-trips every member and refuses non-members', () => {
      expect(ASK_STATES.length).toBe(6);
      expect(new Set(ASK_STATES).size).toBe(ASK_STATES.length);
      for (const s of ASK_STATES) expect(isAskState(s)).toBe(true);
      expect(isAskState('nope')).toBe(false);
      expect(isAskState(null)).toBe(false);
      expect(isAskState(7)).toBe(false);
    });
  });

  describe('AskRefuseCode', () => {
    const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    const oneDefinition = (name: string): string[] =>
      ALL.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, 'utf8'))).map(rel);

    it('is spelled once, in shared/api.ts', () => {
      expect(oneDefinition('ASK_REFUSE_CODE_MAP')).toEqual(['shared/api.ts']);
    });

    it('leaves no second copy of the literal set in inject/ask.ts', () => {
      // D-2174: the union used to live here, inline, with no runtime list.
      expect(read('server/src/inject/ask.ts')).not.toMatch(/'menu-mismatch'\s*;/);
    });

    it('round-trips every member', () => {
      // RULING F1: fourteen, not the brief's ten — the four route-level
      // refusals (`unknown-ask`, `not-held`, `ask-moved`, `not-parent`,
      // emitted by later tasks' routes in server/src/coord) share this same
      // refusal family and so join this one union rather than a second.
      // FIFTEEN since the whole-branch review (M2): `child-unmeasurable`
      // split "this box could not read the child" back out of `ask-moved`,
      // which had been carrying both — a narrowing that reached the shipped
      // coordinator contract, not merely a taxonomy.
      expect(ASK_REFUSE_CODES.length).toBe(15);
      for (const c of ASK_REFUSE_CODES) expect(isAskRefuseCode(c)).toBe(true);
      expect(isAskRefuseCode('nope')).toBe(false);
      expect(isAskRefuseCode(null)).toBe(false);
    });
  });

  // WHOLE-BRANCH REVIEW, F1: the one principal token BOTH sides act on —
  // `server.ts` writes it into `asks.answeredBy`, the PWA renders a
  // different sentence for it ("answered by you"). Two literals would let
  // the writer and the reader drift into a chip that silently stops
  // recognising the operator's own answer and falls back to naming the
  // parent, which is exactly the defect F1 closed.
  describe('ASK_OPERATOR_PRINCIPAL', () => {
    const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    const definers = (): string[] =>
      ALL.filter((f) => /export const ASK_OPERATOR_PRINCIPAL\b/.test(readFileSync(f, 'utf8'))).map(rel);

    it('is spelled once, in shared/api.ts', () => {
      expect(definers()).toEqual(['shared/api.ts']);
    });

    it("leaves no bare 'operator' literal in either file that acts on it", () => {
      // The writer and the renderer, by name. `coord/rundefs.ts` legitimately
      // owns the same WORD for the mail lane (`SYSTEM_MAIL_SENDER_MAP`) and is
      // deliberately not scanned: those members answer "who sent this", a
      // different question from "who pressed the key".
      expect(read('server/src/server.ts')).not.toMatch(/'operator'/);
      // THE ROW'S FAMILY, not one path. This was `read('…/SessionLine.tsx')`
      // until the row's meta line — the half that renders the ask chip and so
      // the half this negative is about — moved to `SessionMeta.tsx`. A
      // negative assertion against a file the code has left does not go red;
      // it goes VACUOUS, which is worse. `componentFamily` follows what the
      // row renders.
      expect(componentFamily(ccrcRoot, 'pwa/src/fleet/SessionLine.tsx'))
        .not.toMatch(/'operator'/);
    });
  });
});

// Task 5 (docs/superpowers/plans/2026-08-20-fleetio-measured-read.md): the
// `'absent' | 'unreadable'` read-failure vocabulary lives once, in
// `shared/agent-protocol.ts`'s `ReadFailure` — it was `server/src/io.ts`'s
// until D-1438 moved it, which is what the first `it()` below asserts and
// what this paragraph went on claiming for a wave — and `registry.ts`'s
// `BranchEvidence`
// DERIVES it (`'named' | ReadFailure | 'empty'`) rather than restating the
// pair — it used to spell `'absent' | 'unreadable'` a second time at
// `registry.ts:21`. `oneDefinition` above is per-named-symbol and hardcodes
// `shared/api.ts` as the one legal home, so it cannot be reused for a
// symbol whose home is `shared/agent-protocol.ts` — this is a bespoke assertion in
// the same style.
//
// The fingerprint is the ORDERED PAIR, not either word alone:
// `shared/api.ts` legitimately declares `WsAuditUnit = 'enabled' | 'loaded'
// | 'absent'`, where `'absent'` appears with no `'unreadable'` beside it —
// a bare `/'absent'/` or `/'unreadable'/` scan would false-positive there.
describe('one absent/unreadable read vocabulary', () => {
  // ORDER-INSENSITIVE (wave-1 review minor m1). The vocabulary is a SET of two
  // words; a second copy that happens to spell them the other way round is
  // exactly the drift this scan exists to catch, and the original single
  // ordering let it through silently. Still a PAIR rather than either word
  // alone — `shared/api.ts`'s `WsAuditUnit = 'enabled' | 'loaded' | 'absent'`
  // is a legitimate lone `'absent'` and must not trip it.
  const PAIR = /'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'/;

  // D-1438: moved from `server/src/io.ts` to `shared/agent-protocol.ts`. The
  // pair is wire-adjacent vocabulary both `agent/src/fileops.ts` and
  // `server/src/io.ts` fold their read/stat outcomes into — declaring it
  // server-side only left the agent side to restate it (twice: `ReadB64Result`
  // and `ReadFromResult`), which is exactly the drift this scan exists to
  // catch. `shared/` is a real consumer of both ends already (`agent/src/
  // server.ts`, `server/src/remote/io.ts` both import `agent-protocol.ts`),
  // so it is the one home reachable from both packages without an agent
  // importing `server/src`.
  it('is declared in exactly one file, and that file is shared/agent-protocol.ts', () => {
    const holders = ALL.filter((f) => PAIR.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('is what registry.ts derives BranchEvidence from, not a second copy', () => {
    const registry = readFileSync(path.join(ccrcRoot, 'server/src/registry.ts'), 'utf8');
    expect(registry).not.toMatch(PAIR);
    expect(registry).toMatch(/export type BranchEvidence = 'named' \| ReadFailure \| 'empty';/);
    expect(registry).toMatch(/import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\/io\.js'/);
  });

  it('server/src/io.ts re-exports ReadFailure rather than restating it', () => {
    const io = readFileSync(path.join(ccrcRoot, 'server/src/io.ts'), 'utf8');
    expect(io).not.toMatch(PAIR);
    expect(io).toMatch(
      /import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/,
    );
  });

  it('agent/src/fileops.ts imports ReadFailure rather than restating it', () => {
    const fileops = readFileSync(path.join(ccrcRoot, 'agent/src/fileops.ts'), 'utf8');
    expect(fileops).not.toMatch(PAIR);
    expect(fileops).toMatch(
      /import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/,
    );
  });

  it('trips on EITHER ordering — a second copy spelled the other way round is still a second copy', () => {
    // Wave-1 review minor m1. The scan is a text scan, so the fingerprint has
    // to be the SET, not one spelling of it. Measured before the fix: a file
    // containing `type X = 'unreadable' | 'absent'` scored zero hits and the
    // suite stayed green.
    expect(PAIR.test("type X = 'unreadable' | 'absent';")).toBe(true);
    expect(PAIR.test("type X = 'absent' | 'unreadable';")).toBe(true);
    // Still not a bare-word scan: `WsAuditUnit = 'enabled' | 'loaded' |
    // 'absent'` must stay invisible, which is the whole reason the fingerprint
    // is a PAIR (see this describe's own header).
    expect(PAIR.test("type WsAuditUnit = 'enabled' | 'loaded' | 'absent';")).toBe(false);
  });
});

// — Stage 4, Task 7: the supervisor sweep's preflight, in BOTH copies —
describe('the supervisor sweep — both copies carry the KillMode=process preflight', () => {
  // R1 (granted 2026-08-21) carves the ONE scoped exception into CLAUDE.md's
  // never-touch rule: `ccrc update`'s step-4 sweep and deploy.sh's existing
  // sweep may try-restart `claude-session@*` units — each ONLY behind the
  // mandatory preflight, because without KillMode=process a try-restart is a
  // fleet kill (every session a child of ONE tmux server sitting in whichever
  // claude-session@ cgroup created it). deploy.sh keeps its own copy for now
  // (it executes over SSH while `ccrc` may be mid-replacement — spec §6), so
  // the safety property exists TWICE by design; this pin is what keeps the
  // two from drifting on it. Deleting the preflight from either copy is a
  // red suite, not a review comment.
  const sweepBodies = (): Array<[name: string, body: string]> => {
    const ccrc = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');
    const upd = /_upd_sweep\(\) \{([\s\S]*?)\n\}/.exec(ccrc);
    expect(upd, 'ccd/ccrc has no _upd_sweep').toBeTruthy();
    const deploySh = readFileSync(path.join(ccrcRoot, 'deploy', 'deploy.sh'), 'utf8');
    // SWEEP_CMD is a single-quoted assignment with no embedded single quotes
    // (deploy.sh's own comment: bash has no escape for one inside one).
    const cmd = /SWEEP_CMD='([\s\S]*?)'/.exec(deploySh);
    expect(cmd, 'deploy.sh has no SWEEP_CMD').toBeTruthy();
    return [['ccd/ccrc _upd_sweep', upd![1]!], ['deploy.sh SWEEP_CMD', cmd![1]!]];
  };

  /** `_upd_sweep`'s two platform arms, split so each arm's preflight is
   *  asserted IN THAT ARM. The first cut of this pin ran its indexOf over the
   *  whole body, and the macOS port's Darwin arm — which spells its guard
   *  `grep -q 'AbandonProcessGroup'` and its restart `_svc_try_restart` —
   *  satisfied nothing and broke nothing: all three indices resolved inside
   *  the Linux arm, and deleting the entire Darwin preflight left this
   *  describe green (measured). The Darwin arm opens at its `$CCD_OS` test
   *  and closes at the arm's own two-space `fi`; every inner block indents
   *  deeper, so the two-space match is the arm's close. deploy.sh's SWEEP_CMD
   *  executes over SSH against the Linux fleet box only and has no arm to
   *  split. */
  const updSweepArms = (body: string): { darwin: string; linux: string } => {
    const d0 = body.indexOf('"$CCD_OS" = darwin');
    expect(d0, '_upd_sweep lost its Darwin arm').toBeGreaterThan(-1);
    const dEnd = body.indexOf('\n  fi', d0);
    expect(dEnd, "_upd_sweep's Darwin arm never closes").toBeGreaterThan(d0);
    return { darwin: body.slice(d0, dEnd), linux: body.slice(dEnd) };
  };

  it('each implementation compares the resolved value to KillMode=process', () => {
    for (const [name, body] of sweepBodies()) {
      const scope = name === 'ccd/ccrc _upd_sweep' ? updSweepArms(body).linux : body;
      expect(scope, `${name} lost its KillMode=process preflight`)
        .toContain('"KillMode=process"');
      expect(scope, `${name} asks the unit file, not systemd — drop-ins would be invisible`)
        .toContain('show -p KillMode');
    }
  });

  it('and in each, the preflight comes BEFORE the try-restart', () => {
    // Not merely present: a guard that runs after the sweep guards nothing.
    for (const [name, body] of sweepBodies()) {
      const scope = name === 'ccd/ccrc _upd_sweep' ? updSweepArms(body).linux : body;
      const guard = scope.indexOf('"KillMode=process"');
      const restart = scope.indexOf('try-restart');
      expect(restart, `${name} has no try-restart — the sweep is gone`).toBeGreaterThan(-1);
      // indexOf's -1 would sit "before" any restart — an ABSENT preflight must
      // red THIS test too, not only its sibling.
      expect(guard, `${name} has no preflight at all`).toBeGreaterThan(-1);
      expect(guard, `${name}: the preflight does not precede the try-restart`)
        .toBeLessThan(restart);
    }
  });

  it('the Darwin arm carries its own preflight — the negated AbandonProcessGroup grep — BEFORE its kickstart', () => {
    // The macOS counterpart of R1's mandate, pinned in the arm that holds it.
    // The NEGATION is part of the pin: `! grep -q` refuses when the key is
    // ABSENT, and inverting it (measured green under the old pin) would make
    // the sweep refuse exactly the boxes that are safe and sweep the ones
    // that are not.
    const [name, body] = sweepBodies()[0]!;
    expect(name).toBe('ccd/ccrc _upd_sweep');
    const { darwin } = updSweepArms(body);
    expect(darwin, 'the Darwin preflight (negated grep) is gone')
      .toContain("! grep -q 'AbandonProcessGroup'");
    const guard = darwin.indexOf("! grep -q 'AbandonProcessGroup'");
    const restart = darwin.indexOf('_svc_try_restart');
    expect(restart, 'the Darwin arm has no _svc_try_restart — the sweep is gone')
      .toBeGreaterThan(-1);
    expect(guard, 'the Darwin preflight does not precede the kickstart')
      .toBeLessThan(restart);
    // Refused is DEGRADED, never fatal — the same spec §6 shape as Linux.
    expect(darwin).toContain('update: DEGRADED: the supervisor sweep did not run');
  });
});

// — Stage 5, Task 2: the release owner (S1) — the deliberate pair, held to two —
describe('the release owner literal — two named assignments, and no third spelling', () => {
  // Three suites now hold three different halves of one fact, and the split is
  // deliberate:
  //   - license.test.ts pins the VALUE — both lanes name the ruled owner, and
  //     the previous org survives nowhere in shipping code;
  //   - ccrc-update.test.ts pins the AGREEMENT — install.sh's owner/repo pair
  //     and ccd/ccrc's are equal, so the two lanes download the same release;
  //   - THIS pins the COUNT — those two assignments are the only spellings of
  //     the org anywhere in shipped code, so a third copy (a hardcoded release
  //     URL in a workflow, a `const OWNER` in the server, a literal in some
  //     deploy script) is a red suite rather than a URL that keeps working
  //     through GitHub's post-transfer redirect and dies the day the old org
  //     name is recreated.
  //
  // TWO definitions, not one, and that is D-92's cross-file class rather than
  // a drift — ccd/ccrc's own release-source header carries the argument:
  // `install.sh --release` runs before any ccrc exists on the box, so it
  // cannot read ccrc's pair, and `ccrc update` runs on boxes install.sh has
  // long left. The stage-5 plan's Task 2 asked for "defined once, in
  // install.sh"; the pin ships against the tree that exists, whose second
  // definition is deliberate and separately held equal (D-191).
  const DEFINES = /^CCRC_RELEASE_OWNER="/;

  /** The org name every scan below hunts for: READ from the definition, never
   *  restated here. A scanner that hand-spelled the owner would follow a
   *  rename one commit late — this file's own disease, in the file that
   *  exists to prevent it. */
  const owner = (): string => {
    const m = /^CCRC_RELEASE_OWNER="([^"]+)"$/m.exec(
      readFileSync(path.join(ccrcRoot, 'install.sh'), 'utf8'));
    expect(m, 'install.sh no longer spells CCRC_RELEASE_OWNER').not.toBeNull();
    return m![1]!;
  };

  const OWNER = owner();

  /** The two lanes, named once. The test below asserts the tree agrees with
   *  this list; every later test DERIVES from it rather than restating it —
   *  a hand-kept second copy of the holder list, inside the suite that exists
   *  to forbid second copies, is the joke this file cannot afford. */
  const HOLDERS = [
    'ccd/ccrc',    // the box's lane — `ccrc update` downloads with it
    'install.sh',  // the clone's lane — `install.sh --release` does too
  ];

  it('is assigned in exactly two bash files, and each is named here BY NAME', () => {
    const holders = BASH
      .filter((f) => codeLines(f).some((l) => DEFINES.test(l)))
      .map(rel).sort();
    expect(holders).toEqual(HOLDERS);
  });

  it('no other line of shipped bash spells the org — everything else derives', () => {
    // Within the two holders, the assignment is the ONLY code line carrying
    // the literal (the URL below each is built from `$CCRC_RELEASE_OWNER`);
    // in every other bash file, no code line carries it at all. Prose may
    // discuss the owner anywhere — only a line of shell is a copy.
    for (const f of BASH) {
      const lines = codeLines(f).filter((l) => l.includes(OWNER));
      const want = DEFINES.test(lines[0] ?? '') && HOLDERS.includes(rel(f))
        ? [`CCRC_RELEASE_OWNER="${OWNER}"`]
        : [];
      expect(lines, rel(f)).toEqual(want);
    }
  });

  it('both lanes build their release URL through the variable, not a restatement', () => {
    // Not merely "no second literal" — deleting the download would satisfy
    // that. Each lane must still READ the variable it defines.
    for (const f of HOLDERS) {
      const uses = codeLines(path.join(ccrcRoot, f))
        .filter((l) => l.includes('$CCRC_RELEASE_OWNER'));
      expect(uses.length, `${f} never reads $CCRC_RELEASE_OWNER`).toBeGreaterThan(0);
    }
  });

  it('the four TS roots never name the org — no server-side release identity', () => {
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes(OWNER)).map(rel);
    expect(holders).toEqual([]);
  });

  it('the workflows never name the org — the release lane derives its repo from the checkout', () => {
    // release.yml's `gh release create` writes to the repository the runner
    // checked out — no owner argument anywhere, which is what lets the repo
    // transfer orgs without touching a workflow. YAML comments are prose,
    // same as bash's (`codeLines` treats both).
    const wfDir = path.join(ccrcRoot, '.github', 'workflows');
    const wfs = readdirSync(wfDir).filter((e) => /\.ya?ml$/.test(e));
    expect(wfs.length, 'the workflow directory is empty — this scan sees nothing').toBeGreaterThan(0);
    for (const wf of wfs) {
      const hits = codeLines(path.join(wfDir, wf)).filter((l) => l.includes(OWNER));
      expect(hits, `.github/workflows/${wf}`).toEqual([]);
    }
  });
});

describe('Build 9 nouns — the lifecycle journal vocabulary', () => {
  const oneDefinition = (decl: RegExp, name: string): void => {
    const hits = ALL.filter((f) => decl.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel), name).toEqual(['shared/api.ts']);
  };

  it('defines each type and its derived list exactly once, in shared/', () => {
    oneDefinition(/^\s*export type LifecycleAct\b/m, 'LifecycleAct');
    oneDefinition(/^\s*export const LIFECYCLE_ACTS\b/m, 'LIFECYCLE_ACTS');
    oneDefinition(/^\s*export const LC_ACT_UNKNOWN\b/m, 'LC_ACT_UNKNOWN');
    oneDefinition(/^\s*export type LifecycleOutcome\b/m, 'LifecycleOutcome');
    oneDefinition(/^\s*export const LIFECYCLE_OUTCOMES\b/m, 'LIFECYCLE_OUTCOMES');
    oneDefinition(/^\s*export const LC_OUTCOME_UNKNOWN\b/m, 'LC_OUTCOME_UNKNOWN');
    oneDefinition(/^\s*export type ActorClass\b/m, 'ActorClass');
    oneDefinition(/^\s*export const ACTOR_CLASSES\b/m, 'ACTOR_CLASSES');
    oneDefinition(/^\s*export type Corroboration\b/m, 'Corroboration');
    oneDefinition(/^\s*export function corroboration\b/m, 'corroboration');
    oneDefinition(/^\s*export type LcRefusalToken\b/m, 'LcRefusalToken');
    oneDefinition(/^\s*export const LC_REFUSAL_WORD\b/m, 'LC_REFUSAL_WORD');
    oneDefinition(/^\s*export interface LifecycleEvent\b/m, 'LifecycleEvent');
    oneDefinition(/^\s*export interface MirroredLifecycleEvent\b/m, 'MirroredLifecycleEvent');
    oneDefinition(/^\s*export function compareGenerations\b/m, 'compareGenerations');
  });

  it('DERIVES every runtime list from its total map — never a hand-written array', () => {
    // The `PR_REASONS`/`SPAWN_VERDICTS`/`DIVERGENCE_KINDS` guard, applied to
    // the five new vocabularies. A member added to a union with no key in its
    // map is TS2739; a key the union does not have is TS2353. A
    // `readonly X[]` literal beside the type gives neither, and accepts a typo.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    for (const [list, map] of [
      ['LIFECYCLE_ACTS', 'LIFECYCLE_ACT_MAP'],
      ['LIFECYCLE_OUTCOMES', 'LIFECYCLE_OUTCOME_MAP'],
      ['ACTOR_CLASSES', 'ACTOR_CLASS_MAP'],
      ['CORROBORATIONS', 'CORROBORATION_MAP'],
      // The refusal list derives from the EXPORTED rendering map itself —
      // there is no private twin, and there must not be one: see the third
      // `it` below.
      ['LC_REFUSAL_TOKENS', 'LC_REFUSAL_WORD'],
      // Account pools wave 2b: the same idiom, applied to `meas` and `dec`
      // key vocabularies (`LIFECYCLE_MEAS_KEY_MAP`/`LIFECYCLE_DEC_KEY_MAP`,
      // both module-private in shared/api.ts). `tsc` already pins each MAP
      // against its interface both ways; this is what pins the exported
      // LIST as DERIVED rather than hand-written (D-1890).
      ['LIFECYCLE_MEAS_KEYS', 'LIFECYCLE_MEAS_KEY_MAP'],
      ['LIFECYCLE_DEC_KEYS', 'LIFECYCLE_DEC_KEY_MAP'],
    ] as const) {
      expect.soft(api, `${list} must derive from ${map}`)
        .toMatch(new RegExp(`export const ${list}[^=]*=\\s*\\n?\\s*Object\\.keys\\(${map}\\)`));
      expect.soft(api, `${list} is a hand-written array`)
        .not.toMatch(new RegExp(`export const ${list}[^=]*=\\s*\\[`));
    }
  });

  it('keeps the NARROWING maps module-private, and the RENDERING map exported', () => {
    // `STOP_SURFACES`' argument (:1215-1223), one level in: with the map
    // unexported, `LIFECYCLE_ACT_MAP[raw]` cannot be written in another file
    // at all, so `isLifecycleAct` is the only narrowing route.
    //
    // LC_REFUSAL_WORD IS THE EXCEPTION, AND THE EXCEPTION IS THE RULE READ
    // CORRECTLY: it renders a token for a person, it narrows nothing, the
    // PWA types its own renderer against it, and `isLcRefusalToken` is still
    // the only door. `SENTENCES` (`wsaudit.ts:17`) is the precedent. A
    // private `LC_REFUSAL_WORD_MAP` twin aliased to an export would be a
    // second name for one value, declared only to satisfy a guard written
    // for the other case — so this test forbids it in BOTH directions.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    for (const m of ['LIFECYCLE_ACT_MAP', 'LIFECYCLE_OUTCOME_MAP', 'ACTOR_CLASS_MAP',
      'CORROBORATION_MAP', 'DEC_CORROBORATES']) {
      expect.soft(api, `${m} must not be exported`)
        .not.toMatch(new RegExp(`^\\s*export const ${m}\\b`, 'm'));
      expect.soft(api, `${m} must exist`).toMatch(new RegExp(`^\\s*const ${m}\\b`, 'm'));
    }
    expect(api, 'LC_REFUSAL_WORD is the renderer and is exported directly')
      .toMatch(/^\s*export const LC_REFUSAL_WORD\b/m);
    expect(api, 'no LC_REFUSAL_WORD_MAP alias — one value, one name')
      .not.toMatch(/LC_REFUSAL_WORD_MAP/);
  });

  it('enumerates the act vocabulary only where the compiler enforces exhaustiveness', () => {
    // The rule, stated as the assertion: a file may list the WHOLE act
    // vocabulary only if a `Record<LifecycleAct, …>` over it makes a missing
    // member a compile error. Two files qualify: `shared/api.ts` (the union
    // and `LIFECYCLE_ACT_MAP`) and — since wave 9 landed it, at
    // `pwa/src/session/journalWords.ts` rather than the `pwa/src/lib/` this
    // comment once predicted (D-215) — `journalWords.ts`, ONLY because it
    // types `ACT_WORD` as `Record<LifecycleAct, string>`.
    //
    // Membership is tested per token in ANY form, quoted or as an object key,
    // the way the `PrReason` scan above does — a quoted-literals-only scan
    // would exclude a map written with unquoted keys by accident rather than
    // by rule.
    const enumerates = (src: string): boolean =>
      LIFECYCLE_ACTS.every((a) => new RegExp(`(?:'${a}'|(?<![\\w'-])${a}\\s*:)`).test(src));
    const holders = ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['pwa/src/session/journalWords.ts', 'shared/api.ts']);
  });

  it('and the act scan is looking at something — guards the guard', () => {
    // A `LIFECYCLE_ACTS` that had gone empty would make `every` vacuously true
    // for EVERY file, turning the assertion above into a list of all 200-odd
    // sources — loud, but for the wrong reason. This fails first, and
    // specifically. Measured when written: the highest-scoring NON-holder is
    // `pwa/src/lib/api.ts` at 8 of 24, so the margin is 15 tokens.
    const enumerates = (src: string): boolean =>
      LIFECYCLE_ACTS.every((a) => new RegExp(`(?:'${a}'|(?<![\\w'-])${a}\\s*:)`).test(src));
    expect(LIFECYCLE_ACTS.length).toBe(28);
    expect(LIFECYCLE_ACTS).toContain(LC_ACT_UNKNOWN);
    expect(enumerates(readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8'))).toBe(true);
    expect(enumerates(readFileSync(path.join(ccrcRoot, 'pwa/src/lib/api.ts'), 'utf8'))).toBe(false);
  });

  it('LC_REFUSAL_WORD has exactly one holder — the second copy is the whole failure mode', () => {
    const tokens = ['scratch-unwritable', 'tip-unreadable', 'bad-session-id',
      'flock-unavailable', 'lock-unopenable', 'is-a-workspace',
      'session-live', 'session-verdict-unknown', 'spawn-failed'];
    const enumerates = (src: string): boolean =>
      tokens.every((t) => src.includes(`'${t}'`));
    expect(ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel))
      .toEqual(['shared/api.ts']);
    expect(tokens.length, 'guards the guard — an empty list passes everything').toBe(9);
  });
});

// Build 9b fix round — the ledger's stale horizon. `LEDGER_STALE_MS` is an L0
// constant ("The present tense's numbers", `shared/api.ts`: every one lives
// THERE and nowhere else) with two readers that must agree: `coord/routes.ts`
// derives the wire `stale` per row from it, and `watch.ts`'s reconcile sweep
// reports stale allocations against it. Wave 7 shipped `watch.ts` carrying a
// private `const LEDGER_STALE_MS = 7 * 24 * 3_600_000` beside the import path
// it already used for other L0 numbers — equal by arithmetic coincidence,
// spelled differently, with nothing forcing agreement: `UNCHECKED_PR`'s exact
// shape, one drift earlier in its life.
describe('one LEDGER_STALE_MS — the stale horizon has one home', () => {
  // A DEFINITION in any form — exported or module-private, which is the form
  // the real copy took — never a mention: an import names the constant
  // without `const … =`, and prose has no assignment at all.
  const DEFINES = /^\s*(?:export\s+)?const\s+LEDGER_STALE_MS\s*=/m;

  it('is defined in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => DEFINES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('is what both readers import, not re-derive', () => {
    // Not merely "the copy is gone" — deleting either reader's staleness
    // logic satisfies that. Each must still reach the shared constant.
    for (const f of ['server/src/coord/routes.ts', 'server/src/watch.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f)
        .toMatch(/import\s*\{[^}]*\bLEDGER_STALE_MS\b[^}]*\}\s*from\s*'[^']*shared\/api\.js'/);
    }
  });
});

describe('graphify — one pin, one census path', () => {
  it("the pip pin literal 'graphifyy==' lives in exactly one bash file, ccd/ccrc", () => {
    expect(holdersOf('graphifyy==')).toEqual(['ccd/ccrc']);
  });
  it('GRAPHIFY_PIN is assigned in exactly one bash file, ccd/ccrc', () => {
    const holders = BASH.filter((f) =>
      codeLines(f).some((l) => /^\s*GRAPHIFY_PIN=/.test(l))).map(rel).sort();
    expect(holders).toEqual(['ccd/ccrc']);
  });
  it("the census path '.ccrc/graph-sweep.json' is spelled by writers/readers, not duplicated as a second constant", () => {
    // The sweep WRITES it; doctor and the session hook READ it. Spelling a
    // path you read is not duplicating a constant — what this guard forbids is
    // a SECOND definition, a `CENSUS=`-shaped copy nothing derives from. The
    // hook is a legitimate third holder (D-1333): it is installed on its own
    // into ~/.cc-sessions and runs as Claude Code's hook with no ccd around to
    // source, so it can only spell the path. The list stays exact-match, so a
    // FOURTH holder still reddens this.
    const holders = holdersOf('graph-sweep.json');
    expect(holders).toEqual(
      ['ccd/ccd-graph-sweep', 'ccd/ccrc-doctor-checks', 'ccd/session-hook.sh']);
  });
});

// — Plan 2b-2 Task 3 (D-3487): the Codex runtime's LiteLLM requirement —
describe('the Codex runtime — one LiteLLM requirement, in one file', () => {
  // `graphify`'s two rows above, for the second venv this tree builds: the
  // requirement (extra, floor and ceiling in ONE string) lives in
  // `ccd/ccgpt-runtime`, and every other reader reads the STAMP a passing
  // build writes. The third row exists because the first two cannot see the
  // files most likely to grow a second copy: `isBash` rejects every dotted
  // name, so a `litellm==` in `ccd/ccgpt-usage.py`, `shared/litellm.mjs` or a
  // `deploy/*.yaml` scores no hit in `holdersOf` at all (runtime-probe HR13).
  it("the requirement literal 'litellm[proxy]' lives in exactly one bash file, ccd/ccgpt-runtime", () => {
    expect(holdersOf('litellm[proxy]')).toEqual(['ccd/ccgpt-runtime']);
  });

  it('LITELLM_REQUIREMENT is assigned in exactly one bash file, ccd/ccgpt-runtime', () => {
    const holders = BASH.filter((f) =>
      codeLines(f).some((l) => /^\s*LITELLM_REQUIREMENT=/.test(l))).map(rel).sort();
    expect(holders).toEqual(['ccd/ccgpt-runtime']);
  });

  it('no other file under ccd, deploy, shared or install.sh — of ANY type — spells a litellm version spec', () => {
    // EVERY line, comments included: this is a literal-absence pin, and prose
    // naming a version is the first draft of a second pin. `--others
    // --exclude-standard` as well as the index, so a new file is seen before
    // it is staged — a gate over the index alone cannot see an uncommitted
    // definition. It refuses to answer when git cannot list the tree.
    const r = spawnSync('git', ['-C', ccrcRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
      '--', 'ccd', 'deploy', 'shared', 'install.sh'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    const files = [...new Set(r.stdout.split('\0').filter(Boolean))].sort();
    // The floor: a scan over too few files passes everything, and these five
    // are the ones this row exists to see — three of them dotted.
    expect(files.length).toBeGreaterThan(50);
    for (const f of ['ccd/ccgpt-runtime', 'ccd/ccgpt-proxy.py', 'ccd/ccgpt-usage.py', 'shared/litellm.mjs', 'install.sh']) {
      expect(files, f).toContain(f);
    }
    const SPEC = /\blitellm\[|\blitellm\s*(?:===|==|~=|>=|<=|!=|<|>)\s*\d/;
    const holders = files.filter((f) => {
      const p = path.join(ccrcRoot, f);
      return existsSync(p) && statSync(p).isFile() && SPEC.test(readFileSync(p, 'utf8'));
    });
    expect(holders).toEqual(['ccd/ccgpt-runtime']);
  });
});

describe('the ccrc-install fixture tree — one TREE_FILES, one installFixtureTree', () => {
  // The same shape as "extraction finding — one path to the ccd script"
  // above, applied to a copy that was made for a stated reason and copied
  // anyway: `ccrc-install.test.ts` and `ccrc-install-graphify.test.ts` each
  // carried their own `TREE_FILES` / `TREE_STUBS` / `installFixtureTree`,
  // both headers citing the same excuse (importing a sibling `.test.ts` module
  // for its helpers double-registers that file's `describe` blocks). The
  // excuse argued for a THIRD file with no `describe()` in it, not for two
  // copies — `installTreeFixture.ts` is that file. The cost of the old shape
  // was measured, not theoretical: an edit to one `TREE_FILES` that missed the
  // other broke 34 tests in the file nobody touched.
  //
  // Scans `server/test` AND `server/test-e2e`, which `ROOTS` above
  // deliberately does not cover, for the same reason the ccd-script-path
  // finding does: these are TEST files, and the fixture they define is data
  // no shipped source ring owns. The sibling directory is in scope for the
  // same reason the ccd-script-path finding put it there — an e2e run that
  // needs the same `ccrc install` tree is exactly the shape that would reach
  // for its own `TREE_FILES` copy rather than importing this one, and a scan
  // that stopped at `server/test` would score that copy no hit at all.
  const testDir = path.join(ccrcRoot, 'server', 'test');
  const testDirs = [testDir, path.join(ccrcRoot, 'server', 'test-e2e')];
  const testFiles = testDirs.flatMap(sources);

  // Matches the shape of an ASSIGNMENT to an array literal, not a reference or
  // an import — an `import { … } from './installTreeFixture.js'` line has no
  // assignment-to-a-bracket in it, so a consumer importing the shared list is
  // not mistaken for a second holder of it. (This comment deliberately never
  // spells the three characters the pattern hunts for adjacently, the same
  // reason the ccd-script-path finding above avoids writing its own literal.)
  const DEFINES_TREE_FILES = /\bTREE_FILES\s*=\s*\[/;
  const DEFINES_TREE_STUBS = /\bTREE_STUBS\s*:\s*Record<string,\s*string>\s*=\s*\{/;
  const DEFINES_INSTALL_FIXTURE_TREE = /(?:export\s+)?function\s+installFixtureTree\(/;

  it('found the test tree it is scanning', () => {
    // A scan over an empty list passes everything. Each directory is checked
    // separately so a moved or renamed sibling turns this red on its own,
    // rather than the other directory's file count silently covering for it
    // (the same reason the ccd-script-path finding's own version of this
    // check does it directory-by-directory rather than on the flattened sum).
    for (const d of testDirs) expect(sources(d).length, rel(d)).toBeGreaterThan(0);
    expect(testFiles.length).toBeGreaterThan(40);
    expect(testFiles.map(rel)).toContain('server/test/installTreeFixture.ts');
    expect(testFiles.map(rel)).toContain('server/test/ccrc-install.test.ts');
    expect(testFiles.map(rel)).toContain('server/test/ccrc-install-graphify.test.ts');
    expect(testFiles.map(rel)).toContain('server/test-e2e/helpers.ts');
  });

  it('TREE_FILES is defined in exactly one file, installTreeFixture.ts', () => {
    const holders = testFiles
      .filter((f) => DEFINES_TREE_FILES.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/installTreeFixture.ts']);
  });

  it('TREE_STUBS is defined in exactly one file, installTreeFixture.ts', () => {
    const holders = testFiles
      .filter((f) => DEFINES_TREE_STUBS.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/installTreeFixture.ts']);
  });

  it('installFixtureTree is defined in exactly one file, installTreeFixture.ts', () => {
    const holders = testFiles
      .filter((f) => DEFINES_INSTALL_FIXTURE_TREE.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/installTreeFixture.ts']);
  });

  it('is what the two former copy sites now import', () => {
    // Not just "the copies are gone" — that is satisfied by deleting the
    // fixture. Each former copy site must still reach the shared module.
    for (const f of ['ccrc-install.test.ts', 'ccrc-install-graphify.test.ts']) {
      const src = readFileSync(path.join(testDir, f), 'utf8');
      expect(src, f).toMatch(
        /import\s*\{[^}]*\binstallFixtureTree\b[^}]*\}\s*from\s*'\.\/installTreeFixture\.js'/);
    }
  });
});

// ── D-2375: the scratch-slug predicate ─────────────────────────────────────
describe('one scratch-slug predicate — four prefixes and one infix, three bash sites, one mirror', () => {
  // "Did the harness mint this slug for a throwaway directory?" is asked at
  // three sites that cannot share a function between them:
  //
  //   - `ccrc`'s `_mem_is_scratch` is the rule and carries the measurement.
  //     Its two callers (the census and `--apply`) reach it directly.
  //   - `ccrc-doctor-checks`'s `_check_memory` cannot: the table is sourced
  //     under `set -u` by things that are not `ccrc` (`ccrc-doctor.test.ts`'s
  //     `tableNames()`), so a `declare -F` guard would be the second spelling
  //     with a branch in front of it. D-92's trade, unchanged.
  //   - `session-hook.sh` is installed INTO an agent home and sources nothing
  //     from this tree at all.
  //
  // So the agreement cannot be structural, and this is the mechanism that
  // holds it instead. It matters more than the usual drift argument does: the
  // hook DERIVES its slug from a live cwd (`pwd -P`), so its own copy can only
  // ever be exercised on the platform the suite runs on — a Linux-only
  // spelling was invisible to every ubuntu leg and to five task reviews, and
  // only `test-macos` caught it. The two read-side sites read a directory
  // NAME, so they are measurable everywhere; this pin is what carries their
  // coverage across to the one site that is not.
  //
  // THE SITE LIST IS THREE BECAUSE THE HOOK ASKS IN SLUG SPACE. It holds the
  // un-lossy value and could ask an exact question of it instead (the
  // completeness critic's C1, 2026-09-10); `_mem_is_scratch`'s own comment
  // records why it does not. If that is ever revisited, this list shrinks to
  // two — a deliberate edit, not a drift.
  const PRED = '-tmp*|-private-tmp*|-var-folders*|-private-var-folders*|*--cc-tmp-*';

  /** The guard line at one site, found by the one token no other line in
   *  these tools carries. Exactly one per file, or the row that reads it is
   *  measuring something it did not mean to. */
  const guardLine = (f: string): string => {
    const hits = codeLines(f).filter((l) => l.includes('-var-folders'));
    expect(hits, `${rel(f)}: expected exactly one scratch-guard code line`).toHaveLength(1);
    return hits[0] ?? '';
  };

  it('is spelled identically at exactly three sites, each named here BY NAME', () => {
    expect(holdersOf(PRED)).toEqual([
      'ccd/ccrc',                 // _mem_is_scratch — the rule, and the measurement
      'ccd/ccrc-doctor-checks',   // _check_memory — spelled here, D-92's trade
      'ccd/session-hook.sh',      // the hook's own case — shares nothing with either
    ]);
  });

  it('each site carries the WHOLE alternation and nothing appended to it', () => {
    // EQUALITY, NOT CONTAINMENT, and the difference is the whole value of this
    // row. `holdersOf` matches with `String.includes`, so the row above stays
    // green when a site APPENDS an alternative — measured 2026-09-10: adding
    // `|-private-var-*` to `session-hook.sh` alone left every Linux-visible
    // row in the tree green while, on Darwin, it would have swept up
    // `/private/var/tmp` and skipped every fixture in `session-hook.test.ts`'s
    // memory-convergence block. Capturing the arm closes both directions at
    // once, and it is what makes the row above's title true.
    for (const f of ['ccd/ccrc', 'ccd/ccrc-doctor-checks', 'ccd/session-hook.sh']) {
      const m = /case "\$(?:1|slug)" in ([^)]*)\)/.exec(guardLine(path.join(ccrcRoot, f)));
      expect(m, `${f}: the scratch guard is not a case arm this row can read`).toBeTruthy();
      expect(m?.[1], f).toBe(PRED);
    }
  });

  it('no site anywhere in the corpus carries the narrower Linux-only spelling', () => {
    // The row above pins the three KNOWN sites. This one has a different
    // population: a FOURTH site, written anywhere in these tools with the
    // pre-D-2375 rule — which named the OS scratch root on Linux and nothing
    // at all on Darwin.
    for (const f of BASH) {
      const narrow = codeLines(f).filter((l) => /in\s+-tmp\*\)/.test(l));
      expect(narrow, rel(f)).toEqual([]);
    }
  });

  it('no site anywhere in the corpus sweeps up /var/tmp, in either spelling', () => {
    // The widening's UPPER BOUND, and the prefix a careless one takes first:
    // `/var/tmp` survives a reboot by design, `session-hook.test.ts` roots its
    // memory-convergence fixtures there, and skipping it would hide a real
    // fork from the operator.
    //
    // BOTH SPELLINGS, and bare rather than glob-anchored. Measured
    // 2026-09-10, twice: an over-widening written `-var-tmp-*` — a dash before
    // the star, which is what a hand actually writes — slipped a needle
    // anchored as `-var-tmp*`; and `-private-var-tmp` is the spelling a real
    // Darwin box produces, which a Linux-only control cannot see at all.
    for (const needle of ['-var-tmp', '-private-var-tmp']) {
      for (const f of BASH) {
        const swept = codeLines(f).filter((l) => l.includes(needle));
        expect(swept, `${rel(f)} (${needle})`).toEqual([]);
      }
    }
  });

  // KNOWN BOUND, stated rather than implied: a FOURTH site written in some
  // other shell shape — a `[[ ]]` test, a helper of its own — is caught by
  // neither the equality row (it reads three sites by name) nor the narrowing
  // row (it looks for the old `case` spelling). Nothing here scans for an
  // arbitrary re-implementation of the question.
  it('the TypeScript mirror in scratchSlugs.ts carries the same four prefixes and one infix', () => {
    // Three suites state fixture preconditions against this rule and none can
    // import a bash `case`, so `server/test/scratchSlugs.ts` is the one mirror
    // they share. The first cut of D-2375 put a copy in each suite and pinned
    // one of the three; this row is why that is now impossible.
    const src = readFileSync(path.join(ccrcRoot, 'server/test/scratchSlugs.ts'), 'utf8');
    const m = /export const SCRATCH_PREFIXES = \[([^\]]*)\]/.exec(src);
    expect(m, 'scratchSlugs.ts declares no SCRATCH_PREFIXES').toBeTruthy();
    const mirror = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    const arms = PRED.split('|'), infix = arms.pop() ?? '';   // A4: the infix has its own list, below
    expect(mirror).toHaveLength(4);           // an empty capture must not pass as agreement
    expect(mirror).toEqual(arms.map((p) => p.replace(/\*$/, '')).sort());
    // A4: stripping only a TRAILING `*` leaves the infix's leading one on, so
    // `arms.map` above cannot fold it in — `SCRATCH_INFIXES` is its own list.
    const im = /export const SCRATCH_INFIXES = \[([^\]]*)\]/.exec(src);
    expect(im, 'scratchSlugs.ts declares no SCRATCH_INFIXES').toBeTruthy();
    const infixMirror = [...(im?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(infixMirror).toEqual([infix.replace(/^\*/, '').replace(/\*$/, '')]);
  });

  it('no suite re-declares the mirror — scratchSlugs.ts is its only home', () => {
    // The same two directories the scans above enumerate rather than name:
    // an unscanned sibling is the "clean and unchecked becomes dirty and
    // unchecked with nothing saying so" shape this file already refuses.
    const holders = [path.join(ccrcRoot, 'server', 'test'),
      path.join(ccrcRoot, 'server', 'test-e2e')]
      .flatMap(sources)
      // ANCHORED TO A DECLARATION, not a mention, and that is not cosmetic:
      // the bare needle read the regex literal in the row above and reported
      // THIS file as a second holder (measured). A declaration is what the
      // row claims anyway.
      .filter((f) => /^\s*(?:export\s+)?(?:const|let|var)\s+SCRATCH_(?:PREFIXES|INFIXES)\s*=/m
        .test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/scratchSlugs.ts']);
  });
});

// ROUTE_WRITABLE_FIELDS, routing spec 2026-09-14 §5.3 (slice 4, Task 3). The
// task brief's own docstring on the constant (`shared/api.ts`) claims
// "single-definition.test.ts scans for a hand-written sibling" — a claim
// that was FALSE from the commit that added it (fix round 1, finding #3):
// nothing in this file ever named `ROUTE_WRITABLE_FIELDS` or its five words
// until this describe. The idiom is `the provider table`'s above
// (:963-1027) — a declaration scan plus an array-literal scan, both over the
// same four ROOTS — applied to this list instead of `PROVIDER_IDS`.
describe('ROUTE_WRITABLE_FIELDS — one list, one home (routing spec §5.3, slice 4)', () => {
  // The positive control, same shape as `the name list this scans is real,
  // and is the roster` above: a scan for a field nothing spells passes
  // everything.
  const FIELDS = ROUTE_WRITABLE_FIELDS;

  it('the field list this scans is real, and is the routing record\'s own list', () => {
    expect(FIELDS.length).toBe(5);
    expect(FIELDS).toContain('class');
  });

  it('ROUTE_WRITABLE_FIELDS is declared in exactly one file under the four roots', () => {
    const RE = /^\s*(?:export\s+)?const\s+ROUTE_WRITABLE_FIELDS\b/m;
    const holders = ALL.filter((f) => RE.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  // The fingerprint every historical copy in this file shares
  // (`enumeratesAsArray`, :859-865, and the provider table's own copy of it,
  // :998-1004): two or more of the five field names quoted inside the SAME
  // `[...]` array literal. `shared/api.ts`'s own definition trips this scan
  // too — it IS such a literal — so the assertion is "in exactly one file",
  // not "nowhere", exactly as the brief's Step 3 states it ("do not respell
  // them in a test either; import").
  //
  // ONE EXEMPTION, BY NAME, AND IT IS A DIFFERENT VOCABULARY — the same shape
  // as `PROBE_KINDS`'s exemption above (:989-1004). `server/src/commands.ts`'s
  // `BUILTINS` table (the PWA's slash-command picker, session-only keystrokes
  // per this slice's own constraints doc) lists `compact` and `effort` as
  // COMMAND NAMES a person can type, which is two of this list's five words —
  // measured, this trips the raw scan. It is not a restatement of the
  // routing record's writable-field vocabulary: `BUILTINS` names KEYSTROKES,
  // this list names RECORD FIELDS a body may set, and neither derives from
  // the other (`subagent`, `workflow` and `class` are not slash commands;
  // `model`, `clear`, `context`, `cost`, `resume` are not routable fields).
  // The exemption is the ARRAY LITERAL, not the file, in case a real second
  // copy of the routing list ever lands beside it.
  const EXEMPT_BUILTINS = /export const BUILTINS: SlashCommand\[\] = \[[\s\S]*?\n\];/;
  const scannable = (src: string): string => src.replace(EXEMPT_BUILTINS, '');
  const enumeratesAsArray = (src: string): boolean => {
    for (const m of src.matchAll(/\[[^\]]*\]/gs)) {
      const hits = FIELDS.filter((w) => new RegExp(`['"]${w}['"]`).test(m[0]));
      if (hits.length >= 2) return true;
    }
    return false;
  };

  it('the BUILTINS exemption is live — commands.ts trips the raw scan and not the exempted one', () => {
    // THE EXEMPTION IS CHECKED, not assumed (the provider table's own lesson,
    // :1017-1021): if `BUILTINS` is renamed, moved, or loses its two-word
    // overlap, this goes red rather than silently exempting a line that no
    // longer matches anything.
    const commands = readFileSync(path.join(ccrcRoot, 'server/src/commands.ts'), 'utf8');
    expect(enumeratesAsArray(commands),
      'BUILTINS no longer trips this scan — delete the exemption above it').toBe(true);
    expect(enumeratesAsArray(scannable(commands)),
      'server/src/commands.ts enumerates route fields somewhere OTHER than BUILTINS').toBe(false);
  });

  it('no source file under the four roots restates the five fields as an array literal, except shared/api.ts', () => {
    const holders = ALL.filter((f) => enumeratesAsArray(scannable(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });
});

describe('the pane read is declared once, in L0', () => {
  // PANE_HISTORY_LINES is echoed back to the PWA in every history response and
  // will be read by wave 3's fit floor beside READER_MIN_COLS and
  // STALL_BUDGET_LINES. A second copy is a second number to keep in step.
  it('PANE_HISTORY_LINES is defined in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export const PANE_HISTORY_LINES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('PaneProbe is declared in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export type PaneProbe\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('PaneHistoryReply is declared in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export type PaneHistoryReply\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('server.ts no longer spells the 2000 itself — it imports the name', () => {
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'server.ts'), 'utf8');
    expect(src, 'server.ts still defines its own PANE_HISTORY_LINES').not.toMatch(/const PANE_HISTORY_LINES\s*=/);
    expect(src, 'server.ts uses the constant without importing it').toMatch(/PANE_HISTORY_LINES/);
  });
});

// ── Design 2026-09-20 §6: the update control plane's vocabularies ──────────
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites
// this file by line (its census carries a `server/test/single-definition.
// test.ts` entry), so an insert above a cited line moves the census.
describe('the update control plane — one definition per vocabulary and wire type (design 2026-09-20 §6)', () => {
  // The `RunState` shape (`Build 7 nouns`): one declaring file, and it is
  // shared/api.ts. A local, un-exported redeclaration counts too — it is the
  // same second copy with one fewer keyword.
  const TYPES = [
    'UpdateChannel', 'UpdateState', 'BusyUpdateState', 'SettledUpdateState', 'UpdatePhase', 'InstallState',
    'ProvenanceState', 'AutoMode', 'NotifyMode', 'RequestKind', 'StampRead', 'NodeRole', 'NodeOs', 'TagFileRead',
    'CatalogueErrorReason', 'ReleaseRefusalWire', 'ReleaseWire', 'NodeRequestWire', 'NodeReportWire',
    'NodeUpdateWire', 'NodeWire', 'UpdateIntentWire', 'CatalogueState', 'UpdatesView', 'UpdateRouteError',
    'UpdateRouteRefusal', 'IntentWriteAnswer', 'AckAnswer',
  ] as const;
  // The DECLARATION shape, not the bare keyword: `type <Name> [<…>] =` or
  // `interface <Name>`, `export`/`declare` optional. The bare `(?:type|
  // interface)\s+<Name>\b` form also matches an inline-type import specifier
  // that happens to open its line (`  type UpdateChannel,` inside a multi-line
  // `import { … }`), which is exactly how store.ts, update/inventory.ts and
  // update/routes.ts import these names in later tasks — every such file would
  // score as a second holder. `Build 7 nouns`' `export type RunState\b` avoids
  // it by requiring `export`; this scan keeps `export` optional (a local
  // un-exported copy is still a copy), so it requires the `=` instead.
  const DEF_OF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  for (const name of TYPES) {
    it(`declares ${name} exactly once, in shared/api.ts`, () => {
      const DEF = DEF_OF(name);
      // Controls, per name, so a later loosening of DEF_OF reds every case:
      // an import specifier is not a declaration; an un-exported one is.
      expect(DEF.test(`import {\n  type ${name},\n} from '../../../shared/api.js';`), 'import specifier').toBe(false);
      expect(DEF.test(`type ${name} = 'a';`), 'un-exported local declaration').toBe(true);
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    });
  }

  const VALUES = [
    'UPDATE_CHANNELS', 'UPDATE_STATES', 'BUSY_UPDATE_STATES', 'SETTLED_UPDATE_STATES', 'UPDATE_PHASES',
    'IN_FLIGHT_UPDATE_PHASES', 'INSTALL_STATES', 'PROVENANCE_STATES', 'AUTO_MODES', 'NOTIFY_MODES',
    'REQUEST_KINDS', 'STAMP_READS', 'NODE_ROLES', 'NODE_OSES', 'TAG_FILE_READS', 'RELEASE_TAG', 'CAP_WORD', 'MAX_CAP_WORDS',
    'FLEET_SCOPE',   // ruling R4: shared/api.ts only — store.ts (Task 6) and resolve.ts/project.ts (Task 12) import it
    'UNIX_SECONDS_MAX',   // C5, final fix wave: resolve.ts and inventory.ts both import it; neither declares its own
  ] as const;
  const GUARDS = [
    'isUpdateChannel', 'isUpdateState', 'isUpdatePhase', 'isInstallState', 'isProvenanceState', 'isAutoMode',
    'isNotifyMode', 'isRequestKind', 'isStampRead', 'isNodeRole', 'isNodeOs', 'isTagFileRead', 'isReleaseTag', 'validCapWords',
  ] as const;
  it('defines every array, pattern and guard exactly once, in shared/api.ts', () => {
    for (const name of VALUES) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
    for (const name of GUARDS) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('StampRead is DERIVED from its array — a hand-written union restates ReadFailure\'s pair', () => {
    // `'absent' | 'unreadable'` spelled in shared/api.ts would make it a second
    // holder in "one absent/unreadable read vocabulary" above, and this file
    // cannot import ReadFailure (peers-claims-l0.test.ts pins its three type
    // imports). So the union comes from STAMP_READS, and update-states.test.ts
    // holds its failure half equal to ReadFailure at compile time.
    const api = readFileSync(path.join(ccrcRoot, 'shared', 'api.ts'), 'utf8');
    expect(api).toMatch(/^export const STAMP_READS = \['ok', 'absent', 'unreadable', 'malformed'\] as const;$/m);
    expect(api).toMatch(/^export type StampRead = \(typeof STAMP_READS\)\[number\];$/m);
  });

  it('spells the tag shape once — every other reader calls isReleaseTag', () => {
    // The literal regex SOURCE, however delimited. `shared/semver.ts` checks
    // its precondition structurally and is held to agree with isReleaseTag by
    // `update-semver.test.ts`, so it is not a holder here either.
    const SHAPE_TEXT = 'v[0-9]+\\.[0-9]+\\.[0-9]+';
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes(SHAPE_TEXT)).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  // THE SQL-TUPLE SCANS — the `TERMINAL_ITEM_STATES` shape. Store code that
  // needs one of these sets in a `WHERE` builds it from the array by `.join`
  // (the `TERMINAL_DELIVERY_SQL` idiom), so the shipped source holds no
  // literal tuple at all; a hand-written `IN ('pending','applying','unknown')`
  // is a second definition of busy that nothing forces to agree.
  //
  // THE FINGERPRINT: a parenthesised list of TWO OR MORE quoted words, every
  // one of them a member, in any order — a copy from memory is as likely in
  // any order. Two or more, because a single `('stable')` states no set; a
  // whole list, because the §6 seed row `('*', 'stable', NULL, 'off',
  // 'channel', 0, 'migration')` carries members beside non-members and is not
  // a copy of any vocabulary (asserted below, since Task 3 ships it).
  // KNOWN WIDTH: a tuple of another vocabulary made only of words it shares
  // with one of these (`('done','failed')` is RunState's and UpdatePhase's)
  // also scores. Measured zero holders for every vocabulary at d759c914; if
  // such a tuple ever lands legitimately it is a hand-typed SQL list of THAT
  // vocabulary, which its own scan should be refusing.
  const esc = (w: string): string => w.replace(/[-]/g, '\\-');
  const tupleOf = (members: readonly string[]): RegExp => {
    const alt = `(?:${members.map(esc).join('|')})`;
    return new RegExp(`\\(\\s*['"]${alt}['"]\\s*(?:,\\s*['"]${alt}['"]\\s*)+\\)`);
  };
  const SQL_VOCABS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['UpdateChannel', UPDATE_CHANNELS], ['UpdateState', UPDATE_STATES], ['UpdatePhase', UPDATE_PHASES],
    ['InstallState', INSTALL_STATES], ['ProvenanceState', PROVENANCE_STATES], ['AutoMode', AUTO_MODES],
    ['NotifyMode', NOTIFY_MODES], ['RequestKind', REQUEST_KINDS], ['StampRead', STAMP_READS],
    ['NodeRole', NODE_ROLES], ['NodeOs', NODE_OSES], ['TagFileRead', TAG_FILE_READS],
  ];

  it('the tuple fingerprint catches a copy in any order and leaves non-copies alone', () => {
    const busy = tupleOf(UPDATE_STATES);
    expect(busy.test("WHERE updateState IN ('pending','applying','unknown')")).toBe(true);
    expect(busy.test("WHERE updateState IN ( 'unknown', \"pending\" )")).toBe(true);
    expect(busy.test("WHERE updateState IN ('idle')"), 'one word is not a set').toBe(false);
    expect(busy.test("WHERE updateState IN ('idle', 'paused')"), 'a non-member breaks the list').toBe(false);
    expect(busy.test("['pending', 'applying', 'unknown'] as const"), 'a TS array is the definition').toBe(false);
    const seed = "INSERT INTO update_intent VALUES ('*', 'stable', NULL, 'off', 'channel', 0, 'migration');";
    expect(tupleOf(AUTO_MODES).test(seed), 'the §6 seed row is not an AutoMode tuple').toBe(false);
    expect(tupleOf(NOTIFY_MODES).test(seed), 'the §6 seed row is not a NotifyMode tuple').toBe(false);
    expect(tupleOf(UPDATE_CHANNELS).test(seed), 'the §6 seed row is not an UpdateChannel tuple').toBe(false);
    expect(tupleOf(UPDATE_PHASES).test("('backing-up', 'installing')"), 'hyphenated members').toBe(true);
  });

  for (const [name, members] of SQL_VOCABS) {
    it(`no source hand-types an SQL tuple of ${name}`, () => {
      const TUPLE = tupleOf(members);
      expect(ALL.filter((f) => TUPLE.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
    });
  }
});

// ── Design 2026-09-20 §6: the update ring ─────────────────────────────────
// "W2 extends that describe to scan server/src/update with an EMPTY
// allowlist" — and D-3187 leans on it: the resolver stays
// L1 and the projection writer L3 BY THEIR IMPORTS, and no file there holds
// the handle. The coord ring (`describe('the coord ring — …')` above)
// allowlists five holders; this one allowlists NONE, so every read and write
// the update modules make goes through a `CoordStore` method.
// APPENDED, not nested inside the coord ring as the spec's sentence reads:
// `session-hook.test.ts`'s citation audit cites this file by line, so an
// insert above a cited line moves its census. It reads the coord ring's
// `REACH` — module-scope, declared under that describe — not a copy.
describe('the update ring — nothing under server/src/update holds the handle (design 2026-09-20 §6)', () => {
  const updateDir = path.join(ccrcRoot, 'server/src/update');
  /** Every file the ring is known to hold, appended by the task that
   *  creates it (W2: catalogue.ts, inventory.ts, resolve.ts, project.ts,
   *  routes.ts). A FLOOR, not a count: a new file raises it rather than
   *  breaking it, and a listed file that is gone — a moved or renamed
   *  directory — reds instead of disarming the scan. */
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts', 'dispatch.ts', 'converge.ts'];
  // A bare `import 'node:sqlite'` and a dynamic `import('node:sqlite')` count
  // too — the coord ring's `from\s+'node:sqlite'` sees neither. Either quote: a double-quoted specifier
  // (`from "node:sqlite"`) is valid TS and would otherwise pass this scan unseen (D-3407 fix round).
  const IMPORTS_SQLITE = /(?:\bfrom\s+|\bimport\s*\(?\s*)['"]node:sqlite['"]/;
  const IMPORTS_DB = /(?:\bfrom\s+|\bimport\s*\(?\s*)['"](?:\.{1,2}\/)+(?:coord\/)?db\.js['"]/;
  const IMPORTS_UPDATE = /\bfrom\s+['"](?:\.\/|(?:\.\.\/)+)update\//;
  /** Over `[name, source]` pairs, so the CONTROL below plants its shapes as
   *  text — no fixture directory, and so no new import line in this file. */
  const ringViolations = (files: readonly (readonly [string, string])[]): string[] =>
    files.flatMap(([name, src]) => [
      ...(IMPORTS_SQLITE.test(src) ? [`${name} imports node:sqlite`] : []),
      ...(IMPORTS_DB.test(src) ? [`${name} imports a coord db module`] : []),
      ...(REACH.test(src) ? [`${name} names a database handle on a coord/store receiver`] : []),
    ]);
  const onDisk = (dir: string): (readonly [string, string])[] =>
    sources(dir).map((f) => [path.relative(dir, f), readFileSync(f, 'utf8')] as const);

  it('covers the directory — absent means nothing expects it, present means every listed file is visited (never a skip)', () => {
    if (!existsSync(updateDir)) {
      expect(UPDATE_RING_FILES,
        'files are listed for an update ring that is not on disk — was the directory moved?').toEqual([]);
      const importers = sources(path.join(ccrcRoot, 'server/src'))
        .filter((f) => IMPORTS_UPDATE.test(readFileSync(f, 'utf8'))).map(rel);
      expect(importers, 'a server/src file imports from an update directory this scan cannot see').toEqual([]);
      return;
    }
    const names = sources(updateDir).map((p) => path.relative(updateDir, p));
    for (const f of UPDATE_RING_FILES) expect(names, `${f} is listed but not on disk`).toContain(f);
    expect(names.length).toBeGreaterThanOrEqual(UPDATE_RING_FILES.length);
  });

  it('no file there imports node:sqlite or a coord db module, or reaches for a handle — an EMPTY allowlist', () => {
    expect(existsSync(updateDir) ? ringViolations(onDisk(updateDir)) : []).toEqual([]);
  });

  it('CONTROL: each forbidden shape is caught on planted text, and a store import is not', () => {
    expect(ringViolations([
      ['a.ts', "import 'node:sqlite';\n"],
      ['b.ts', "import type { DatabaseSync } from 'node:sqlite';\n"],
      ['c.ts', "import { tx } from '../coord/db.js';\n"],
      ['d.ts', 'export const n = (coord: { db: unknown }) => tx(coord.db, () => 1);\n'],
      ['e.ts', "import type { CoordStore } from '../coord/store.js';\nexport const f = (s: CoordStore) => s.intents();\n"],
    ]).sort()).toEqual([
      'a.ts imports node:sqlite',
      'b.ts imports node:sqlite',
      'c.ts imports a coord db module',
      'd.ts names a database handle on a coord/store receiver',
    ]);
  });

  it('CONTROL: a double-quoted specifier is caught too — valid TS the single-quote-only scan would miss', () => {
    expect(ringViolations([
      ['f.ts', 'import { readFileSync } from "node:fs";\nimport type { DatabaseSync } from "node:sqlite";\n'],
      ['g.ts', 'import { tx } from "../coord/db.js";\n'],
    ]).sort()).toEqual([
      'f.ts imports node:sqlite',
      'g.ts imports a coord db module',
    ]);
  });
});

// — design 2026-09-20 §8: the ~/.ccrc node-file names, declared once —
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites this
// file by line (`:32-37`, `:1274`, `:1303`), so an insert above those moves them.
describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
  /** F16 (fix round 1, dispatch E, m2): DERIVED from the import of
   *  NODE_FILE_BASENAMES, never hand-typed — a hand-typed copy goes vacuous
   *  SILENTLY the moment a NODE_FILES value is renamed (it would simply stop
   *  matching anything, never redding the "declared once" case above, which
   *  scans for a DIFFERENT literal). A DYNAMIC import, not a static
   *  top-of-file one: this file's own lines above `NINE_BASENAMES` are
   *  `session-hook.test.ts`'s citation anchors (`:32-37`, `:1274`, `:1303`),
   *  and every edit in this describe stays END-OF-FILE only — a new
   *  top-of-file import line would shift every one of them. */
  let NINE_BASENAMES: readonly string[] = [];
  beforeAll(async () => {
    ({ NODE_FILE_BASENAMES: NINE_BASENAMES } = await import('../../shared/agent-protocol.js'));
  });

  it('is declared in exactly one file, and that file is shared/agent-protocol.ts', () => {
    const holders = ALL.filter((f) => /^\s*export const NODE_FILES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  /** Comment lines blanked before the QUOTED scan runs — this codebase's own
   *  convention is to name these basenames in BACKTICK-quoted PROSE inside a
   *  docstring (`` `update-intent` is in the agent's read set `` and the
   *  like), and F16's widened, quote-agnostic regex would otherwise read
   *  every one of those mentions as a second CODE definition. Same shape as
   *  `update-writer-groups.test.ts`'s `blankComments`, copied rather than
   *  imported — a test file does not import another test file's internals. */
  const blankComments = (src: string): string =>
    src.split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');

  // F16 (m2): hoisted to describe scope and shared by both the real case and
  // its own CONTROL below — a REDECLARED copy in the CONTROL tested nothing
  // about the case it claimed to control (measured: reverting the real
  // case's regex to single-quote-only stayed green, CONTROL included).
  const QUOTED = /(['"`])(?:ccrc-caps|update\.json|update-intent|box-token-generation)\1/;

  it('the four names no older code spells are quoted nowhere else — every reader goes through NODE_FILES', () => {
    // `build.json`, `installed`, `floor` and `previous` are ordinary words older
    // code already spells (`config.ts`'s `buildInfoPath`, the agent's own stamp
    // reader), and `node-id` is also a W1 CAP word (`ccd/ccrc`'s
    // `CCRC_CAP_WORDS`) a later task may test for; these three are new with the
    // control plane (and `box-token-generation` with the box-token lifecycle,
    // wave 1), so a second quoted copy is a second definition. F16: a
    // BACKREFERENCE, not a fixed `'…'` — a double-quoted or backtick re-list
    // is the same second definition, and the un-widened regex missed both.
    const holders = ALL.filter((f) => QUOTED.test(blankComments(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it("CONTROL: the QUOTED case reads all three quote styles, not just single-quoted (F16)", () => {
    expect(QUOTED.test('const x = "ccrc-caps";'), 'double-quoted went unseen').toBe(true);
    expect(QUOTED.test('const x = `update-intent`;'), 'backtick-quoted went unseen').toBe(true);
    expect(QUOTED.test("const x = 'update.json';"), 'single-quoted (the original case) regressed').toBe(true);
    expect(QUOTED.test("const x = 'box-token-generation';"), 'the ninth name went unseen').toBe(true);
    expect(QUOTED.test('const x = "update.json`;'), 'mismatched quote characters falsely matched').toBe(false);
  });

  it("the agent's read grant imports NODE_FILE_BASENAMES", () => {
    // Renamed (F16): this checks only the import. Whether agent/src ALSO
    // carries a second, re-typed list beside it is the next case's job — a
    // title claiming "never re-lists it" was never itself checked here.
    const wl = readFileSync(path.join(ccrcRoot, 'agent', 'src', 'whitelist.ts'), 'utf8');
    expect(wl).toMatch(/import\s*\{[^}]*\bNODE_FILE_BASENAMES\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/);
  });

  /** Every file under `agent/src` (any depth) that spells ALL NINE basenames
   *  as string literals (any quote style) — a file that does is a second
   *  list, whether or not it also imports `NODE_FILE_BASENAMES`. Takes
   *  fixture pairs so the CONTROL below can drive it without touching a real
   *  file (F16). */
  const agentBasenameHolders = (files: readonly { path: string; src: string }[]): string[] =>
    files
      .filter(({ src }) => NINE_BASENAMES.every((n) => new RegExp(`(['"\`])${n.replace('.', '\\.')}\\1`).test(src)))
      .map((f) => f.path);

  it('no file in agent/src re-lists all nine basenames beside the NODE_FILE_BASENAMES import (F16)', () => {
    // Anti-vacuity (F16, m2): the derived list really does carry all nine —
    // a NODE_FILES shrink or a broken import would otherwise let this
    // describe run over an empty or partial set and pass for the wrong reason.
    expect(NINE_BASENAMES, 'NODE_FILE_BASENAMES did not import, or the vocabulary shrank').toHaveLength(9);
    const files = ALL.filter((f) => rel(f).startsWith('agent/src/'))
      .map((f) => ({ path: rel(f), src: readFileSync(f, 'utf8') }));
    expect(files.length, 'the agent/src scan is over nothing').toBeGreaterThan(3);
    expect(agentBasenameHolders(files)).toEqual([]);
  });

  it('CONTROL: a planted re-list of all nine basenames beside the import reds the check above (F16)', () => {
    const real = readFileSync(path.join(ccrcRoot, 'agent', 'src', 'whitelist.ts'), 'utf8');
    const planted = `${real}\nconst ALSO = ["build.json", 'installed', \`ccrc-caps\`, 'floor', "previous", 'node-id', \`update.json\`, "update-intent", 'box-token-generation'];\n`;
    expect(agentBasenameHolders([{ path: 'agent/src/whitelist.ts', src: planted }]),
      'a planted re-list of all nine went unseen').toEqual(['agent/src/whitelist.ts']);
    expect(agentBasenameHolders([{ path: 'agent/src/whitelist.ts', src: real }]),
      'the real file false-reds with no re-list planted').toEqual([]);
  });

  it("the ready frame's ops field has ONE reader in server/src", () => {
    const hits = ALL.filter((f) => rel(f).startsWith('server/src/'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bframe\.ops\b/g)].map(() => rel(f)));
    expect(hits).toEqual(['server/src/remote/client.ts']);
  });
});

describe('the release summary clause is spelled once, in L0 (plan W3 Task 3)', () => {
  // D-3301: the release push's body (server) and the update banner (pwa) say the same
  // clause. A second spelling in either package is a sentence to keep in step by hand, so it has ONE holder
  // across the four TS roots — the L0 module both import.
  it("'fleet and server are on ' is spelled in shared/update-summary.ts and nowhere else", () => {
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes('fleet and server are on ')).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });

  // Fix round 2 (review of def82cd4): `remoteSides` moved here from
  // `pwa/src/fleet/BuildLine.tsx` (D-3313) in fix round 1, but no case here ever pinned it as a single
  // holder — `update-summary.test.ts`'s own comment claimed this suite already did, falsely.
  it('remoteSides is declared once, in shared/update-summary.ts', () => {
    const holders = ALL.filter((f) => /^\s*export function remoteSides\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });

  // Fix round 2 (review of d5aefc4a, item 5): `statedOf` — the one predicate for "does this reading vouch
  // for its version" (measuredAt/stampRead/reachable) — is called from `pushRelease` (server), the banner,
  // BuildLine and FleetHostBanner's skew arm (PWA); none of them may re-derive the same three-clause fact
  // inline, the exact drift BuildLine's own narrower `reachable`-only form was before this fix.
  it('statedOf is declared once, in shared/update-summary.ts', () => {
    const holders = ALL.filter((f) => /^\s*export function statedOf\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });

  // W5 review 161 (F-J): the "one holder" scan above catches only a SECOND
  // `export function statedOf`, by name — it never caught `pendingTag`
  // (`pwa/src/fleet/useUpdatesView.ts`) re-deriving the exact same three
  // clauses inline, unnamed, which is the copy a reasonable author actually
  // writes (the file's own header explains why: a scan reads text, not
  // meaning). This widens the trap to that shape too — every one of the three
  // field names, PLUS a `=== 'ok'`/`!== 'ok'` stampRead comparison AND a
  // `=== true`/`!== true` reachable comparison, within a short window of each
  // other — outside `shared/update-summary.ts` itself. A plain fixture object
  // (`stampRead: 'ok', reachable: true,`) never trips it: those are property
  // assignments, not comparisons, so `ALL` (src only, no test fixtures) stays
  // clean today; `pendingTag` now reads `statedOf(n)` instead of restating it.
  it('no inline three-clause copy of statedOf\'s predicate (measuredAt + stampRead + reachable, compared) exists outside shared/update-summary.ts', () => {
    const WINDOW = 6;
    const offenders = ALL.filter((f) => {
      if (rel(f) === 'shared/update-summary.ts') return false;
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const w = lines.slice(i, i + WINDOW).join('\n');
        if (/measuredAt/.test(w) && /stampRead/.test(w) && /reachable/.test(w)
          && /(!==|===)\s*'ok'/.test(w) && /(!==|===)\s*true/.test(w)) return true;
      }
      return false;
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

// Design 2026-09-20 §9/§13 (programme wave 3, Task 7; D-3305):
// the ccrc-caps word the auto-install gate reads is spelled ONCE. W2 declared it
// in the server's L1 resolver, which the PWA cannot import — and the settings
// screen now disables its auto-install control on the same word
// (D-3297), so a second literal in pwa/src would be two
// spellings of one gate that nothing forces to agree. The declaration moved to
// L0 and `server/src/update/resolve.ts` re-exports it, so every W2 importer
// keeps its path. KNOWN WIDTH: the literal scan reads single- and double-quoted
// strings; a backticked mention is prose (`routes.ts`'s docstring names the word
// that way) and a template-literal copy in code would pass it. APPENDED after the
// file's last line: `session-hook.test.ts`'s citation audit cites this file by
// line, so nothing above may move (R13).
describe('the auto-install gate word is declared once, in L0 (programme wave 3)', () => {
  const LITERAL = /(['"])update-gate\1/;
  const DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+UPDATE_GATE_CAP\b/m;

  it('CONTROL: the patterns see a declaration and a quoted copy, and not a re-export or a prose mention', () => {
    expect(DEF.test("export const UPDATE_GATE_CAP = 'update-gate';")).toBe(true);
    expect(DEF.test('const UPDATE_GATE_CAP = GATE;'), 'an un-exported copy is still a copy').toBe(true);
    expect(DEF.test('export { UPDATE_GATE_CAP };'), 'a re-export declares nothing').toBe(false);
    expect(DEF.test("import { UPDATE_GATE_CAP } from '../../../shared/api.js';"), 'an import declares nothing').toBe(false);
    expect(LITERAL.test("caps.includes('update-gate')")).toBe(true);
    expect(LITERAL.test('caps.includes("update-gate")')).toBe(true);
    expect(LITERAL.test('lacks `update-gate` in its measured caps'), 'a backticked prose mention').toBe(false);
    expect(LITERAL.test("'update-gates'"), 'another word').toBe(false);
  });

  it('UPDATE_GATE_CAP is declared in shared/api.ts and nowhere else — resolve.ts re-exports it', () => {
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('the word is quoted in shared/api.ts and nowhere else across the four roots', () => {
    expect(ALL.filter((f) => LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});

// — design 2026-09-20 §10: the update op's refusal words and its launcher, declared once —
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites this
// file by line (`:32-37`, `:1274`, `:1303`), so an insert above those moves them.
describe('the update op — its refusal words and its launcher are declared once', () => {
  it('UPDATE_OP_ERRORS and UpdateOpError are each declared in exactly one file, shared/agent-protocol.ts', () => {
    for (const re of [/^\s*export const UPDATE_OP_ERRORS\b/m, /^\s*export type UpdateOpError\b/m]) {
      const holders = ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders, String(re)).toEqual(['shared/agent-protocol.ts']);
    }
  });

  it('the five words are listed together in one file, in any order or quote style — a second list is a second vocabulary', async () => {
    // The words alone don't prove a copy: `bad-tag` and `busy` are also
    // route and store words (`UpdateRouteError`, `UPDATE_STORE_REFUSE_CODES`),
    // and the dispatcher's answer mapping names `spawn-failed` in a `case`.
    // What proves a second vocabulary is all five TOGETHER — derived from
    // `UPDATE_OP_ERRORS` itself, so a reordered or double-quoted copy still
    // counts, not just this file's own single-quoted, in-order spelling. A
    // holder is a single line, or a single `[...]` array-literal span, that
    // quotes all five.
    // A dynamic import, not a static top-of-file line: an import line above `:32-37` shifts every
    // line the citation audit anchors (R13; the F16 `NODE_FILES` describe above does the same).
    const { UPDATE_OP_ERRORS } = await import('../../shared/agent-protocol.js');
    const words = [...UPDATE_OP_ERRORS];
    const quoted = (w: string): RegExp => new RegExp(`(['"])${w}\\1`);
    const hasAllWords = (span: string): boolean => words.every((w) => quoted(w).test(span));
    const isListHolder = (text: string): boolean =>
      text.split('\n').some(hasAllWords) || (text.match(/\[[^[\]]*\]/g) ?? []).some(hasAllWords);
    const holders = ALL.filter((f) => isListHolder(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  // Both scans below must not fire on `shared/agent-protocol.ts`'s OWN
  // docstrings (around lines 379 and 386), which legitimately say
  // `` `$HOME/.local/bin/ccrc` `` / `` `<home>/.local/bin/ccrc` `` as prose —
  // so both read the source with every comment line (a trimmed start of
  // `//`, `/*` or `*`) stripped first.
  const stripCommentLines = (text: string): string =>
    text
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'));
      })
      .join('\n');

  it("the launcher's path parts are spelled in one file — the agent and the server-role spawn call updateLauncherPath", () => {
    // The three-arg array literal, and the two ways a `join(home, ...)` caller
    // could split it across two arguments instead: `'.local', 'bin/ccrc'` or
    // `'.local/bin', 'ccrc'`. Either quote style.
    const PARTS =
      /['"]\.local['"]\s*,\s*['"]bin['"]\s*,\s*['"]ccrc['"]|['"]\.local['"]\s*,\s*['"]bin\/ccrc['"]|['"]\.local\/bin['"]\s*,\s*['"]ccrc['"]/;
    const holders = ALL.filter((f) => PARTS.test(stripCommentLines(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('no TS root spells the launcher as one quoted path string', () => {
    // `'…/.local/bin/ccrc'`, `"…/.local/bin/ccrc/…"`, or a backtick template
    // (`` `${home}/.local/bin/ccrc` ``) — no leading `/` is required before
    // `.local`, so a bare `'.local/bin/ccrc'` counts too. `ccrc-api`'s path
    // (`coord/envelope.ts`) is a different binary and does not match: the
    // character after `ccrc` must be a quote, a slash, or the end of the line.
    const QUOTED = /['"`][^'"`\n]*\.local\/bin\/ccrc(?:['"`/]|$)/m;
    const holders = ALL.filter((f) => QUOTED.test(stripCommentLines(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual([]);
  });
});

// ── Programme wave 5 (design 2026-09-20 §9/§10): the dispatcher's words and order ──
// APPENDED after the file's last line: `session-hook.test.ts`'s citation audit
// cites this file by line, so nothing above may move (R13). No import is
// added either — the twelve words are stated here as a LITERAL, on purpose (the
// opposite of W2's `SQL_VOCABS`, which imports its arrays): `update-dispatch.test.ts` holds L0's array equal to
// this same list, and the fingerprint below must find shared/api.ts's array,
// so a word added on one side alone reds one of the two.
//
// THE FINGERPRINT is W2's SQL-tuple shape widened to brackets: two or more
// quoted members and nothing else, in any order, parenthesised OR bracketed —
// a copy from memory is as likely a `['halted', 'not-newer']` filter as an SQL
// `IN (…)`. A Record keyed by the type (dispatch.ts's sentences, the PWA's
// UPDATE_ERROR_TEXT) is braced, held exhaustive by the compiler, and is not a
// copy. KNOWN WIDTH: a list spelled across a spread or a template is not seen.
describe('the dispatcher refusal words and the dispatch order are declared once, in L0 (programme wave 5)', () => {
  const WORDS = [
    'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
    'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet', 'no-bundle',
  ];
  const alt = `(?:${WORDS.map((w) => w.replace(/-/g, '\\-')).join('|')})`;
  const item = `\\s*['"]${alt}['"]\\s*`;
  const LIST = new RegExp(`\\(${item}(?:,${item})+,?\\s*\\)|\\[${item}(?:,${item})+,?\\s*\\]`);
  const DEF = /^\s*(?:export\s+)?(?:declare\s+)?(?:type\s+DispatchRefusal\b\s*(?:<[^>\n]*>)?\s*=|interface\s+DispatchRefusal\b)/m;
  const VALUE = /^\s*(?:export\s+)?(?:const|let|var)\s+DISPATCH_REFUSALS\b/m;
  const FNS = ['isDispatchRefusal', 'dispatchRank', 'compareDispatchOrder'] as const;

  it('CONTROL: the list fingerprint sees a copy in any order, either bracket, and nothing that is not one', () => {
    expect(LIST.test("if (['halted', 'not-newer'].includes(w))")).toBe(true);
    expect(LIST.test("WHERE why IN ( 'waiting-for-fleet', \"halted\" )")).toBe(true);
    expect(LIST.test("[\n  'no-detach-cap',\n  'no-rollback-cap',\n]")).toBe(true);
    expect(LIST.test("['halted']"), 'one word states no set').toBe(false);
    expect(LIST.test("['halted', 'busy']"), 'a non-member breaks the list').toBe(false);
    expect(LIST.test("{ 'not-newer': 'a', halted: 'b' }"), 'a keyed record is not a list').toBe(false);
    expect(LIST.test("moveRefusal(view, 'halted')"), 'an argument list with a non-literal').toBe(false);
  });

  it('declares DispatchRefusal once, in shared/api.ts', () => {
    expect(DEF.test("import {\n  type DispatchRefusal,\n} from '../../../shared/api.js';"), 'import specifier').toBe(false);
    expect(DEF.test("type DispatchRefusal = 'halted';"), 'un-exported local declaration').toBe(true);
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('defines the array, its guard, the rank and the comparator once, in shared/api.ts', () => {
    expect(ALL.filter((f) => VALUE.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    for (const name of FNS) {
      const FN = new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => FN.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('no source across the four roots spells a second list of the words — shared/api.ts holds the one', () => {
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});

// WORKER STALL WATCH, WAVE 1 (design 2026-09-29 §4.2, "Spelled once"). APPENDED, not nested, for the reason stated
// at this file's other appended describes: `session-hook.test.ts`'s citation audit cites this file by line.
// The needles are anchored on BOTH sides by the same quote, single or double, for three reasons:
// - `stall-check:` must not be found inside `re stall-check:`;
// - `review-done` must not be found inside the review-rejection subject `close.ts` spells;
// - `stall` must not be found inside `stall-shadow`.
// KNOWN WIDTH: a copy written in backticks, or as the head of a longer template, is not seen. Backticks are left out
// ON PURPOSE: docstrings name these prefixes in backticks, and a pin that fired on a comment would be a false red.
describe('the stall watch spells its prefixes, its detail heads and the review-done subject once (design 2026-09-29 §4.2)', () => {
  const quoted = (needle: string): RegExp => {
    const escaped = needle.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
    return new RegExp(`(['"])${escaped}\\1`);
  };
  const ONE_HOME: ReadonlyArray<readonly [string, string]> = [
    ['stall-check:', 'server/src/coord/stall.ts'],
    ['re stall-check:', 'server/src/coord/stall.ts'],
    ['re stall-check: waiting', 'server/src/coord/stall.ts'],
    ['stall:', 'server/src/coord/stall.ts'],
    ['wait:', 'server/src/coord/stall.ts'],
    ['stall', 'server/src/coord/stall.ts'],
    ['stall-shadow', 'server/src/coord/stall.ts'],
    ['review-done', 'shared/api.ts'],
  ];

  it('CONTROL: a quote-anchored needle finds either quote, and never a longer sibling or a backticked mention', () => {
    expect(quoted('stall-check:').test(`x = 're stall-check:'`)).toBe(false);
    expect(quoted('re stall-check:').test(`x = 're stall-check: waiting'`)).toBe(false);
    expect(quoted('review-done').test(`subject: 'review-done-rejected'`)).toBe(false);
    expect(quoted('stall').test(`'stall-shadow'`)).toBe(false);
    expect(quoted('stall-check:').test(`"stall-check:"`)).toBe(true);
    expect(quoted('stall-check:').test(`'stall-check:'`)).toBe(true);
    expect(quoted('stall-check:').test(`'stall-check:"`)).toBe(false);
    expect(quoted('wait:').test('a docstring naming `wait:`')).toBe(false);
  });

  for (const [needle, home] of ONE_HOME) {
    it(`'${needle}' is a quoted literal in exactly one source file, ${home}`, () => {
      const re = quoted(needle);
      const holders = ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders).toEqual([home]);
    });
  }
});

// ── Worker stall watch, wave 1 (spec 2026-09-29 §9.14 and §4.2 "Spelled once").
// APPENDED after the last describe, never nested above it: session-hook.test.ts's
// citation audit cites this file by line, so nothing above this point may move.

/** Comment LINES removed — the filter the setDeliveryEnvelope describe keeps
 *  block-local as `codeOnly` (hoisting it would move this file's cited lines,
 *  so the two stall describes below share this appended copy) — so a sentence
 *  ABOUT a name is never counted as spelling it. */
const stallCodeText = (t: string): string =>
  t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
const stallCode = (f: string): string => stallCodeText(readFileSync(f, 'utf8'));

describe('worker stall watch: the four operator-switch markers have no writer in the tree (spec §9.14)', () => {
  // Each marker is touched and removed BY HAND in the fleet box's
  // `~/.cc-sessions` — the `mail-disabled` precedent, whose own no-writer
  // claim nothing pins. So the only code that may spell one is the pure
  // module that READS it, in two halves: no non-comment line of shell (ccd/,
  // deploy/, install.sh — `holdersOf` above) names it at all, and across the
  // four TS roots exactly one file names it on a code line — its definer,
  // which reaches no `node:` module and so cannot write a file. A template
  // (`${reg}/stall-watch-live`) is seen: the TS half scans the bare name on
  // code lines, not a quoted literal. KNOWN WIDTH: a name assembled from pieces
  // (`'stall-watch-' + w`) is not seen; the bar is the ordinary copy.
  const MARKERS: [string, string][] = [
    ['mail-gate-strict', 'server/src/turnidle.ts'],
    ['stall-watch-disabled', 'server/src/coord/stall.ts'],
    ['stall-watch-live', 'server/src/coord/stall.ts'],
    ['stall-watch-escalate', 'server/src/coord/stall.ts'],
  ];

  it('CONTROL: both corpora were walked, and the filter keeps code and drops prose', () => {
    expect(BASH.length).toBeGreaterThan(10);
    expect(ALL.length).toBeGreaterThan(100);
    expect(stallCodeText("  // touch stall-watch-live\n   * stall-watch-live\n/* stall-watch-live */\nconst m = `${reg}/stall-watch-live`;"))
      .toBe('const m = `${reg}/stall-watch-live`;');
  });

  it.each(MARKERS)('%s: no shell line names it, and its one TS holder is its definer (%s)', (name, definer) => {
    expect(holdersOf(name), `${name}: a line of shell names it — a writer, or a reader this design never had`).toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(name)).map(rel).sort(),
      `${name}: spelled on a code line outside ${definer}`).toEqual([definer]);
    expect(stallCode(path.join(ccrcRoot, definer)), `${definer} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
});

describe('worker stall watch: the wave-done subject is spelled once (spec §4.2 "Whose turn it is")', () => {
  // `WAVE_DONE_SUBJECT` is L0's, and the stall ball rule compares it by
  // EQUALITY — so a second literal is a second rule. Task 4's appended pins
  // already hold the five prefixes, the detail heads and `REVIEW_DONE_SUBJECT`;
  // this row adds the one done subject that predates the watch.
  // QUOTE-ANCHORED at both ends for '…' and "…" — so `'re stall-check:'` never
  // counts as a copy of `'stall-check:'`, nor close.ts's `'review-done-rejected'`
  // as `'review-done'` — and at the open for a template, whose tail is
  // interpolated. Code lines only: prose names `wave-done` in backticks all
  // over the coord ring, and a sentence is not a definition. KNOWN WIDTH: a
  // literal assembled from pieces is not seen.
  const LITERALS: [string, string][] = [
    ['wave-done', 'shared/api.ts'],
  ];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spelling = (lit: string): RegExp => new RegExp(`'${esc(lit)}'|"${esc(lit)}"|\`${esc(lit)}`);

  it('CONTROL: the anchor tells a constant from its longer neighbours', () => {
    expect(spelling('stall-check:').test("const P = 're stall-check:';")).toBe(false);
    expect(spelling('re stall-check:').test("const P = 're stall-check: waiting';")).toBe(false);
    expect(spelling('review-done').test("subject: 'review-done-rejected'")).toBe(false);
    expect(spelling('wave-done').test('const S = "wave-done";')).toBe(true);
    expect(spelling('stall:').test('const d = `stall:${arm}`;')).toBe(true);
  });

  it.each(LITERALS)("'%s' is spelled on a code line in %s alone", (lit, home) => {
    expect(ALL.filter((f) => spelling(lit).test(stallCode(f))).map(rel).sort(), `a second '${lit}'`).toEqual([home]);
  });
});

describe('the archive door\'s refusal codes are spelled once, in L0 (workspace lifecycle wave 2)', () => {
  // `ARCHIVE_REFUSALS` (spec §5.2) is the one declaration; the server sends `ARCHIVE_REFUSALS.<name>` and the PWA
  // compares against it. `run-open` was a bare literal written twice in `server.ts` and once in
  // `ArchiveConflictSheet.tsx` before this wave. Code lines only (`stallCode`): prose names the codes in backticks.
  // Two OTHER vocabularies share spellings, and each is excused here by name rather than by widening the scan:
  //   - `server/src/wsaudit.ts` keys its sentences by ccd's AUDIT verdict words, two of which ccd also dies with
  //     in `cmd_ws_archive` (`session-busy`, `status-unknown`) — the audit's seam, not the door's;
  //   - `className="run-open"` is the runs board's row button (D-287), a CSS identity — excluded by the pattern.
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = (code: string): RegExp => new RegExp(`(?<!className=)(['"\`])${esc(code)}\\1`);
  const AUDIT_WORDS = new Set(['session-busy', 'status-unknown']);

  it('CONTROL: the pattern sees a quoted code and passes over a class name and a longer word', () => {
    expect(literal('run-open').test("error: 'run-open',")).toBe(true);
    expect(literal('run-open').test('className="run-open"')).toBe(false);
    expect(literal('worktree-gone').test("'worktree-gone-later'")).toBe(false);
    expect(ALL.filter((f) => literal('coordinator-has-open-runs').test(stallCode(f))).map(rel))
      .toEqual(['shared/api.ts']);
  });

  // The codes as test DATA, bound to the declaration by the first case: a scan driven by `Object.values` alone would
  // scan nothing, and stay green, on a tree where the declaration is gone.
  const CODES = ['run-open', 'session-busy', 'coordinator-has-open-runs', 'programme-partly-ended', 'worktree-gone',
    'status-unknown', 'manifest-unbuildable'];

  it('scans every code the declaration holds', () => {
    expect(Object.values(ARCHIVE_REFUSALS ?? {}).sort()).toEqual([...CODES].sort());
  });

  it.each(CODES)("'%s' is a code-line literal in shared/api.ts alone", (code) => {
    const want = AUDIT_WORDS.has(code) ? ['server/src/wsaudit.ts', 'shared/api.ts'] : code === 'worktree-gone' ? ['server/src/docs/policy.ts', 'shared/api.ts', 'shared/docs.ts'] : ['shared/api.ts'];
    expect(ALL.filter((f) => literal(code).test(stallCode(f))).map(rel).sort(), `a second '${code}'`).toEqual(want);
  });
});

// WORKER STALL WATCH, WAVE 2 (design 2026-09-29 §5.2). APPENDED after the last describe, for the reason the wave-1
// blocks above state: `session-hook.test.ts`'s citation audit cites this file by line. The two self-wake prefixes
// join the spelled-once set: a second quoted copy is a second classifier (`stallMailClass`'s `self-wake`) in waiting.
// The needle is quote-anchored at both ends, as ONE_HOME's is, so the update lane's `failed: deadline` prose and a
// backticked docstring mention are not copies. KNOWN WIDTH: a copy in backticks, or at the head of a longer
// literal, is not seen.
describe('the stall watch spells its wave-2 self-wake prefixes once (design 2026-09-29 §5.2)', () => {
  const quotedW2 = (needle: string): RegExp => {
    const escaped = needle.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
    return new RegExp(`(['"])${escaped}\\1`);
  };
  const ONE_HOME_W2: ReadonlyArray<readonly [string, string]> = [
    ['orphaned:', 'server/src/coord/stall.ts'],
    ['failed:', 'server/src/coord/stall.ts'],
  ];

  it('CONTROL: the needle finds a bare quoted prefix in either quote, never a longer literal or a backticked mention', () => {
    expect(quotedW2('failed:').test(`x = 'failed:'`)).toBe(true);
    expect(quotedW2('failed:').test(`x = "failed:"`)).toBe(true);
    expect(quotedW2('failed:').test(`detail: 'failed: deadline'`)).toBe(false);
    expect(quotedW2('orphaned:').test('a docstring naming `orphaned:`')).toBe(false);
  });

  for (const [needle, home] of ONE_HOME_W2) {
    it(`'${needle}' is a quoted literal in exactly one source file, ${home}`, () => {
      const holders = ALL.filter((f) => quotedW2(needle).test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders).toEqual([home]);
    });
  }
});

describe('worker stall watch wave 2: the three new operator-switch markers have no writer in the tree (spec §5)', () => {
  // Wave 1's describe above, for the three markers wave 2 adds. It is appended, never merged into that one, because
  // this file is cited by line. SUBSTRING CAVEAT: both halves match with `includes`, and `mail-gate-busy` is a
  // substring of `mail-gate-busy-shadow`, so the `mail-gate-busy` row counts every holder of EITHER spelling: a
  // superset. That is sound only while both are spelled in `turnidle.ts` alone (planning departure
  // `gate-markers-spelled-in-turnidle-only` (D-3607)), and the CONTROL row states the superset so nobody reads the row as more.
  // `stall-watch-live` is not a substring of `stall-watch-w2-live`, so wave 1's row is untouched by this one.
  const MARKERS: [string, string][] = [
    ['stall-watch-w2-live', 'server/src/coord/stall.ts'],
    ['mail-gate-busy-shadow', 'server/src/turnidle.ts'],
    ['mail-gate-busy', 'server/src/turnidle.ts'],
  ];

  it('CONTROL: the match is a substring — a line spelling mail-gate-busy-shadow also holds mail-gate-busy, never the reverse', async () => {
    expect(stallCodeText("export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';").includes('mail-gate-busy')).toBe(true);
    expect(stallCodeText("export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';").includes('mail-gate-busy-shadow')).toBe(false);
    // From the SHIPPED names, never two literals (a literal against a literal can never fail): of every operator-switch
    // marker the two describes pin, the one pair where a name holds another is the busy pair the caveat names. Imported
    // here, not at the head of the file, because this file is cited by line.
    const { STALL_MARKERS } = await import('../src/coord/stall.js');
    const gate = await import('../src/turnidle.js');
    const names: string[] = [...STALL_MARKERS, gate.MAIL_GATE_STRICT_MARKER, gate.MAIL_GATE_BUSY_MARKER, gate.MAIL_GATE_BUSY_SHADOW_MARKER];
    expect(names.flatMap((a) => names.filter((b) => a !== b && a.includes(b)).map((b) => `${a} holds ${b}`)))
      .toEqual([`${gate.MAIL_GATE_BUSY_SHADOW_MARKER} holds ${gate.MAIL_GATE_BUSY_MARKER}`]);
  });

  it.each(MARKERS)('%s: no shell line names it, and its one TS holder is its definer (%s)', (name, definer) => {
    expect(holdersOf(name), `${name}: a line of shell names it — a writer, or a reader this design never had`).toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(name)).map(rel).sort(),
      `${name}: spelled on a code line outside ${definer}`).toEqual([definer]);
    expect(stallCode(path.join(ccrcRoot, definer)), `${definer} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
});

describe('worker stall watch wave 2: the self-wake prefixes are spelled once (spec §5.2)', () => {
  // `STALL_ORPHANED_PREFIX` and `STALL_FAILED_PREFIX`: `stallMailClass` reads an `operator` mail whose subject starts
  // with either as `self-wake` (recorded, never pushed), so a second literal is a second rule. The anchor is the
  // wave-done describe's, restated because that one's helpers are scoped to its own describe. QUOTE-ANCHORED, and at
  // the open for a template; code lines only. KNOWN WIDTH: a literal assembled from pieces is not seen.
  const LITERALS: [string, string][] = [
    ['orphaned:', 'server/src/coord/stall.ts'],
    ['failed:', 'server/src/coord/stall.ts'],
  ];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spelling = (lit: string): RegExp => new RegExp(`'${esc(lit)}'|"${esc(lit)}"|\`${esc(lit)}`);

  it('CONTROL: the anchor sees a constant and a template head, and not a longer neighbour', () => {
    expect(spelling('failed:').test("export const STALL_FAILED_PREFIX = 'failed:';")).toBe(true);
    expect(spelling('orphaned:').test('const s = `orphaned: ${n} background task(s)`;')).toBe(true);
    expect(spelling('failed:').test("const d = 'failed: provenance:';")).toBe(false);
    expect(spelling('failed:').test("const t = 'not failed:';")).toBe(false);
  });

  it.each(LITERALS)("'%s' is spelled on a code line in %s alone", (lit, home) => {
    expect(ALL.filter((f) => spelling(lit).test(stallCode(f))).map(rel).sort(), `a second '${lit}'`).toEqual([home]);
  });
});

describe('one releasedFromOf (workspace lifecycle wave 1)', () => {
  // `FleetSession.releasedFrom` has ONE reader, `releasedFromOf` in `shared/api.ts`. The live `fleet` frame is
  // CAST, not revived, so a raw property read anywhere else meets `undefined` from a server older than the field,
  // where the accessor answers `null` — the two-readers drift this suite exists to forbid. Comment LINES are
  // blanked first (the field is NAMED in prose across the tree), line by line — `blankComments`' shape above. A
  // block-comment regex is NOT safe here: a `/*` inside a string or a `//` line (`server.ts`'s `.cc-limits/*.json`)
  // opens a "comment" that swallows hundreds of lines of real code, the `/ws/fleet` handler among them (measured).
  const code = (f: string): string => readFileSync(f, 'utf8')
    .split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');
  const READ = /\.releasedFrom\b/;

  it('is read as a property in exactly one file, and that file is shared/api.ts', () => {
    expect(ALL.filter((f) => READ.test(code(f))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('the scan sees the one read it licenses (a blanker that ate code would pass the pin above vacuously)', () => {
    expect(code(path.join(ccrcRoot, 'shared', 'api.ts'))).toMatch(/return s\.releasedFrom \?\? null;/);
  });
});

describe('worker stall watch wave 5: the largest epoch a Date holds is spelled once', () => {
  // The turn marker's reader bounds every epoch by it (`marker-epochs-bounded` (D-3662)) and the watch's formatter
  // refuses a value past it (`stallIso`). Two literals are two bounds that can drift apart; the reader's bound is
  // only a guarantee for the formatter while they are the same number. Code lines only, so a sentence about it is
  // not a second spelling.
  const SPELLING = /\b8\.64e15\b|\b8_?640_?000_?000_?000_?000\b/;

  it('CONTROL: the pattern sees both spellings of the number, and not a neighbour', () => {
    expect(SPELLING.test('export const STALL_EPOCH_MAX = 8.64e15;')).toBe(true);
    expect(SPELLING.test('const M = 8_640_000_000_000_000;')).toBe(true);
    expect(SPELLING.test('const M = 8.64e14;')).toBe(false);
  });

  it('is spelled on a code line in server/src/coord/stall.ts alone', () => {
    expect(ALL.filter((f) => SPELLING.test(stallCode(f))).map(rel).sort(), 'a second spelling').toEqual(['server/src/coord/stall.ts']);
  });
});

// Docs reader W1a (design 2026-10-01: section 2 (a), section 2 (f), section 6.1, mutation row 48's TypeScript
// half): every docs cap and every value grammar is declared ONCE, in L0 `shared/docs.ts`. The python parity copies
// in `ccd/ccd` sit outside ROOTS, so `docs-parity.test.ts` binds those; this pins the one TypeScript copy. APPENDED
// after the file's last line: `session-hook.test.ts`'s citation audit cites this file by line, so nothing above
// may move.
describe('docs L0 single definitions (docs reader W1a, row 48)', () => {
  const DOCS_TS = path.join(ccrcRoot, 'shared', 'docs.ts');
  /** A declaration of `name`, exported or not; an import or a re-export declares nothing. */
  const DEF = (name: string): RegExp =>
    new RegExp(String.raw`^\s*(?:export\s+)?(?:const|let|var)\s+` + name + String.raw`\b`, 'm');
  const text = new Map<string, string>();
  const src = (f: string): string => {
    const hit = text.get(f);
    if (hit !== undefined) return hit;
    const t = readFileSync(f, 'utf8');
    text.set(f, t);
    return t;
  };
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(src(f))).map(rel);

  it('CONTROL: DEF sees a declaration and an un-exported copy, and not an import, a re-export or a longer name', () => {
    expect(DEF('DOCS_MAX_ENTRIES').test('export const DOCS_MAX_ENTRIES = 5000;')).toBe(true);
    expect(DEF('DOCS_MAX_ENTRIES').test('  const DOCS_MAX_ENTRIES = 5000;'), 'an un-exported copy is still a copy').toBe(true);
    expect(DEF('DOCS_MAX_ENTRIES').test("import { DOCS_MAX_ENTRIES } from '../../shared/docs.js';")).toBe(false);
    expect(DEF('DOCS_MAX_ENTRIES').test('export { DOCS_MAX_ENTRIES };'), 'a re-export declares nothing').toBe(false);
    expect(DEF('DOCS_MAX_ENTRIES').test('export const DOCS_MAX_ENTRIES_SEEN = 1;'), 'another name').toBe(false);
  });

  // Each cap holds its OWN literal. DOCS_MAX_DOC_BYTES and DOCS_MAX_IMAGE_BYTES are both 2 MiB by two separate
  // rulings, so "one definition" must mean an own-value literal, never an alias of the neighbour that happens to
  // hold the same integer (HOLD_ROUTE_REASON_MAX_BYTES's argument, above). The grammar bounds are held to the same
  // rule.
  describe('docs caps are declared once, in shared/docs.ts, each its own literal', () => {
    const CAPS = [
      'DOCS_MAX_FILE_BYTES', 'DOCS_MAX_DOC_BYTES', 'DOCS_MAX_IMAGE_BYTES', 'DOCS_ENVELOPE_RESERVE',
      'DOCS_MAX_ANSWER_BYTES', 'DOCS_MAX_LISTING_WIRE_BYTES', 'DOCS_MAX_ENTRIES', 'DOCS_DRAFT_HASH_BUDGET',
      'DOCS_MAX_DRAFTS', 'DOCS_MAX_IMAGES_PER_PAGE', 'DOCS_FETCH_MIN_INTERVAL_MS', 'DOCS_STALE_MS',
      'DOCS_RETRY_FLOOR_MS',
      'DOCS_REF_MAX_CHARS', 'DOCS_PATH_MAX_BYTES', 'DOCS_PATH_MAX_COMPONENT_BYTES', 'DOCS_PATH_MAX_DEPTH',
    ];
    const OWN = (name: string): RegExp => new RegExp('^export const ' + name + String.raw`\s*=\s*\d+\s*;`, 'm');

    it('CONTROL: OWN accepts an integer literal and refuses an alias and an expression', () => {
      expect(OWN('DOCS_MAX_IMAGE_BYTES').test('export const DOCS_MAX_IMAGE_BYTES = 2097152;')).toBe(true);
      expect(OWN('DOCS_MAX_IMAGE_BYTES').test('export const DOCS_MAX_IMAGE_BYTES = DOCS_MAX_DOC_BYTES;'), 'an alias').toBe(false);
      expect(OWN('DOCS_MAX_IMAGE_BYTES').test('export const DOCS_MAX_IMAGE_BYTES = 2 * 1024 * 1024;'), 'an expression').toBe(false);
    });

    it.each(CAPS)('%s is declared in shared/docs.ts and nowhere else across the four roots', (name) => {
      expect(holders(DEF(name))).toEqual(['shared/docs.ts']);
    });

    it.each(CAPS)('%s holds its own integer literal', (name) => {
      expect(OWN(name).test(src(DOCS_TS)), `${name} must read \`export const ${name} = <digits>;\``).toBe(true);
    });
  });

  // Each grammar is a pattern body. DEF pins its declaration. LITERAL pins the body text itself, by a
  // backslash-free fingerprint, so a copy written as a regex literal, a raw template or an escaped string is seen
  // alike. The commit and fingerprint bodies are plain hex runs that unrelated code already spells (measured at
  // planning: `[0-9a-f]{40}` in four server/src files, `[0-9a-f]{64}` in one), so those two are pinned by DEF alone.
  // The section body is derived by `join`, so its spelled-out form belongs in no file at all. KNOWN WIDTH: a body
  // rebuilt from fragments evades LITERAL; `docs-parity.test.ts` still compares the helper's copy with the value.
  describe('docs grammar bodies are declared once, in L0', () => {
    const BODIES = [
      'DOC_SECTIONS', 'DOCS_PROJECT_RE_BODY', 'DOCS_BARE_REF_RE_BODY', 'DOCS_QUALIFIED_PREFIX_RE_BODY',
      'DOCS_QUALIFIED_REF_RE_BODY', 'DOCS_SHA_RE_BODY', 'DOCS_FINGERPRINT_RE_BODY', 'DOCS_MAX_BYTES_RE_BODY',
      'DOCS_SECTION_RE_BODY', 'DOCS_REL_PATH_RE_BODY', 'DOCS_PATH_EXCLUDED_CATEGORIES', 'DOCS_PATH_EXCLUDED_RANGES',
    ];
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /** [what, fingerprint, the files that may hold it, a planted copy it must see, a near miss it must not]. */
    const LITERALS: readonly (readonly [string, RegExp, readonly string[], string, string])[] = [
      ['project', new RegExp(esc('[A-Za-z0-9_][A-Za-z0-9._-]{0,99}')), ['shared/docs.ts'],
        'const P = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;', 'const P = /^[A-Za-z0-9._-]+$/;'],
      ['bare ref', new RegExp(esc('(?!HEAD$)(?!refs/)')), ['shared/docs.ts'],
        "const R = '^(?!HEAD$)(?!refs/)(?!.*\\\\.\\\\.)';", "if (s === 'HEAD') return false;"],
      ['qualified prefix', new RegExp(esc('(?:refs/heads/|refs/remotes/origin/)')), ['shared/docs.ts'],
        "new RegExp('^(?:refs/heads/|refs/remotes/origin/)')", "s.startsWith('refs/heads/')"],
      ['max-bytes', new RegExp(esc('[1-9][0-9]{0,7}')), ['shared/docs.ts'],
        'const N = /^[1-9][0-9]{0,7}$/;', 'const N = /^[0-9]+$/;'],
      ['rel path', new RegExp(esc('(?!/)(?!.*/$)(?!.*//)')), ['shared/docs.ts'],
        'const X = String.raw`(?!/)(?!.*/$)(?!.*//)`;', "const X = '(?!/)';"],
      ['section map', /(['"`])docs\/product-design\1/, ['shared/docs.ts'],
        "  'product-design': 'docs/product-design',", '// docs/product-design is a section'],
      ['section', new RegExp(esc('specs|plans|product-design|conventions')), [],
        "const S = 'specs|plans|product-design|conventions';", "const S = 'specs|plans';"],
      ['path categories', /(['"])Cf\1,\s*(['"])Zl\2,\s*(['"])Zp\3,\s*(['"])Co\4,\s*(['"])Cn\5/, ['shared/docs.ts'],
        'const C = ["Cf","Zl","Zp","Co","Cn"];', "const C = ['Cf', 'Zl'];"],
      ['selector ranges', /0xe0100\s*,\s*0xe01ef/i, ['shared/docs.ts'],
        'const V = [[0xFE00, 0xFE0F], [0xE0100, 0xE01EF]];', 'const V = 0xe0100;'],
    ];

    it('CONTROL: each fingerprint sees its planted copy and not its near miss', () => {
      for (const [what, re, , copy, miss] of LITERALS) {
        expect(re.test(copy), `${what}: the planted copy`).toBe(true);
        expect(re.test(miss), `${what}: the near miss`).toBe(false);
      }
    });

    it.each(BODIES)('%s is declared in shared/docs.ts and nowhere else across the four roots', (name) => {
      expect(holders(DEF(name))).toEqual(['shared/docs.ts']);
    });

    it.each(LITERALS.map(([what, re, files]) => [what, re, files] as const))(
      'the %s body is spelled out only where it is declared', (_what, re, files) => {
        expect(holders(re)).toEqual([...files]);
      });
  });
});

// Docs W1, Task 2 (spec 2026-10-01 section 2 (b), section 2 (i), section 3.5): the failure vocabulary, its retry
// classes, the redactor and the ccd wire types each have ONE home, `shared/docs.ts`. The server's L1 status table,
// its L3 adapter and the PWA's sentence table all key on these names, so a second declaration is a second
// vocabulary that nothing forces to agree. The python copies (`FAILURES`, `REDACT_RULES`) live in `ccd/ccd`,
// outside ROOTS; `docs-parity.test.ts` binds those. APPENDED after the file's last line:
// `session-hook.test.ts`'s citation audit cites this file by line, so nothing above may move.
describe('docs failure vocabulary, redactor and ccd wire types are declared once, in shared/docs.ts (docs W1)', () => {
  const DOCS = path.join(ccrcRoot, 'shared', 'docs.ts');
  const TYPES = [
    'DocsFailure', 'DocsRetryClass', 'DocsFetchFailure', 'DocsNotAFileKind', 'DocsFailureContext', 'DocsFailureBody',
    'DocsVerb', 'DocsGithub', 'DocsTreeOk', 'DocsEntry', 'DraftsFacts', 'DocsShowOk', 'DocsFetchOk', 'DocsIndexOk',
    'DocsIndexRow', 'DocsCcdFailure',
  ] as const;
  const VALUES = ['DOCS_FAILURES', 'DOCS_FAILURE_RETRY', 'DOCS_CCD_FAILURES', 'DOCS_REDACT_RULES'] as const;
  const FUNCTIONS = ['redactDocsText'] as const;
  // The declaration shapes of the update-control-plane describe above (its `DEF_OF` is block-local there): a
  // type needs its `=` and an interface its keyword, so an inline `type X,` import specifier is no holder.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
  const holdersOf = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);

  it('CONTROL: each shape sees a declaration and an un-exported copy, and not an import, a re-export or a longer name', () => {
    expect(TYPE_DEF('DocsFailure').test("export type DocsFailure = keyof typeof DOCS_FAILURES;")).toBe(true);
    expect(TYPE_DEF('DocsFailure').test("type DocsFailure = 'bad-ref';"), 'an un-exported copy is still a copy').toBe(true);
    expect(TYPE_DEF('DocsTreeOk').test('export interface DocsTreeOk {'), 'an interface').toBe(true);
    expect(TYPE_DEF('DocsFailure').test("import {\n  type DocsFailure,\n} from '../../../shared/docs.js';"), 'an import specifier').toBe(false);
    expect(TYPE_DEF('DocsFailure').test('export type DocsFailureBody = { ok: false };'), 'a longer name').toBe(false);
    expect(VALUE_DEF('DOCS_FAILURES').test('export const DOCS_FAILURES = {'), 'a declaration').toBe(true);
    expect(VALUE_DEF('DOCS_FAILURES').test("export { DOCS_FAILURES } from './docs.js';"), 'a re-export').toBe(false);
    expect(VALUE_DEF('DOCS_FAILURES').test('const DOCS_FAILURES_SEEN = 1;'), 'a longer name').toBe(false);
    expect(FUNCTION_DEF('redactDocsText').test('export function redactDocsText(s: string): string {')).toBe(true);
    expect(FUNCTION_DEF('redactDocsText').test('const x = redactDocsText(s);'), 'a call').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares type ${name} exactly once, in shared/docs.ts`, () => {
      expect(holdersOf(TYPE_DEF(name))).toEqual(['shared/docs.ts']);
    });
  }

  it('declares every value and the redactor function exactly once, in shared/docs.ts', () => {
    for (const name of VALUES) expect(holdersOf(VALUE_DEF(name)), name).toEqual(['shared/docs.ts']);
    for (const name of FUNCTIONS) expect(holdersOf(FUNCTION_DEF(name)), name).toEqual(['shared/docs.ts']);
  });

  it('spells the redactor patterns in one TS file: no second copy of a rule', () => {
    // Fragments every copy of rules 2 and 3 must contain however it is escaped or quoted.
    for (const fragment of ['(?:access_token|token)=', 'gh[opsu]_']) {
      expect(ALL.filter((f) => readFileSync(f, 'utf8').includes(fragment)).map(rel), fragment).toEqual(['shared/docs.ts']);
    }
  });

  it('DOCS_CCD_FAILURES is derived from DOCS_FAILURES, never hand-listed', () => {
    const src = readFileSync(DOCS, 'utf8');
    expect(src).toMatch(
      /^export const DOCS_CCD_FAILURES: readonly DocsFailure\[\] =\n {2}\(Object\.keys\(DOCS_FAILURES\) as DocsFailure\[\]\)\.filter\(\(w\) => DOCS_FAILURES\[w\] === 'ccd'\);$/m,
    );
  });

  it('DOCS_FAILURE_RETRY is typed by the vocabulary, so a new word does not compile until it is placed', () => {
    const src = readFileSync(DOCS, 'utf8');
    expect(src).toMatch(/^export const DOCS_FAILURE_RETRY: Record<DocsFailure, DocsRetryClass> = \{$/m);
    expect(src).toMatch(/^export type DocsFailure = keyof typeof DOCS_FAILURES;$/m);
  });
});

// Native Docs reader, W1 Task 3 (spec 5.1, 5.3, 6.1, 3.5, 4.11): the content-class table, the raster table,
// the class caps, the docs response headers, the HTTP wrappers and the link resolver each have ONE declaring
// file, shared/docs.ts. The server's file route and its onSend hook (W2) and the PWA's renderer and link policy
// (W5, W6) import them; a second copy would be a second answer to "what class is this file", "what may this
// route send" or "where does this link go". APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line, so nothing above may move.
describe('docs content classes, headers, wrappers and resolver are declared once, in shared/docs.ts (docs W1 Task 3)', () => {
  const TYPES = [
    'DocContentClass', 'RasterType', 'RasterMime', 'DocRefResolution',
    'DocsProjectsResponse', 'DocsTreeResponse', 'DocsFileResponse', 'DocsRefreshFetch', 'DocsRefreshResponse',
  ] as const;
  const VALUES = [
    'DOC_CONTENT_CLASS_BY_EXT', 'DOCS_CLASS_CAP', 'DOCS_RASTER_TYPES', 'DOCS_RASTER_EXT',
    'DOCS_RESPONSE_CSP', 'DOCS_RESPONSE_HEADERS', 'DOCS_ALLOWED_CONTENT_TYPES',
  ] as const;
  const FUNCTIONS = ['contentClass', 'sniffRaster', 'resolveDocRef'] as const;
  // The declaration shapes of the update-control-plane block above: a type needs its `=` (or `interface`), so
  // an inline `type X,` import specifier is not a holder; a value is a `const`/`let`/`var`; a function is a
  // `function` declaration. `export` is optional throughout: an un-exported local copy is still a copy.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
  const holdersOf = (def: RegExp): string[] => ALL.filter((f) => def.test(readFileSync(f, 'utf8'))).map(rel);

  it('CONTROL: each pattern sees a planted declaration, exported or not, and not an import or a use', () => {
    expect(TYPE_DEF('DocContentClass').test("export type DocContentClass = 'markdown';")).toBe(true);
    expect(TYPE_DEF('DocContentClass').test("type DocContentClass = 'a';"), 'an un-exported copy').toBe(true);
    expect(TYPE_DEF('DocsFileResponse').test('export interface DocsFileResponse { ok: true }')).toBe(true);
    expect(TYPE_DEF('DocContentClass').test("import {\n  type DocContentClass,\n} from '../../../shared/docs.js';"),
      'an import specifier').toBe(false);
    expect(TYPE_DEF('DocContentClass').test("  contentClass: Exclude<DocContentClass, 'raster'>;"), 'a use').toBe(false);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test('export const DOCS_CLASS_CAP: Record<DocContentClass, number> = {')).toBe(true);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test('const DOCS_CLASS_CAP = {};'), 'an un-exported copy').toBe(true);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test("import { DOCS_CLASS_CAP } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test('  const cap = DOCS_CLASS_CAP[cls];'), 'a use').toBe(false);
    expect(FUNCTION_DEF('contentClass').test('export function contentClass(path: string): DocContentClass {')).toBe(true);
    expect(FUNCTION_DEF('contentClass').test('function contentClass(p: string) {'), 'an un-exported copy').toBe(true);
    expect(FUNCTION_DEF('contentClass').test('  const cls = contentClass(pin.path);'), 'a call').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares the type ${name} once, in shared/docs.ts`, () => {
      expect(holdersOf(TYPE_DEF(name))).toEqual(['shared/docs.ts']);
    });
  }

  it('declares every table and header value once, in shared/docs.ts', () => {
    for (const name of VALUES) expect(holdersOf(VALUE_DEF(name)), name).toEqual(['shared/docs.ts']);
  });

  it('declares contentClass, sniffRaster and resolveDocRef once, in shared/docs.ts', () => {
    for (const name of FUNCTIONS) expect(holdersOf(FUNCTION_DEF(name)), name).toEqual(['shared/docs.ts']);
  });

  it("spells the docs CSP text once: the server's hook and the browser leg import DOCS_RESPONSE_CSP", () => {
    const CSP_TEXT = "img-src data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";
    expect(ALL.filter((f) => readFileSync(f, 'utf8').includes(CSP_TEXT)).map(rel)).toEqual(['shared/docs.ts']);
  });

  it('spells the PNG signature once: the L1 raster verdict wraps sniffRaster rather than copying the table', () => {
    const PNG_MAGIC = /0x89\s*,\s*0x50\s*,\s*0x4e\s*,\s*0x47/i;
    expect(PNG_MAGIC.test('[0x89, 0x50, 0x4E, 0x47, 0x0d]'), 'CONTROL: a copy in another case').toBe(true);
    expect(PNG_MAGIC.test('[0x89, 0x51, 0x4e, 0x47]'), 'CONTROL: another signature').toBe(false);
    expect(ALL.filter((f) => PNG_MAGIC.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
  });
});

// Docs W1a, Task 4 (spec 2026-10-01 4.6 and 3.11): the entry view and the GitHub link builder
// are declared once, in shared/docs.ts. The PWA's rows and leaf headers both call entryView
// ("one badge function", spec 2 (d)), so a second derivation of a badge, or a second URL
// builder, anywhere in the four roots is the drift this pins. The pattern-2 bundle shape of
// the update control plane block above, with a planted CONTROL. APPENDED after the file's
// last line: `session-hook.test.ts`'s citation audit cites this file by line.
describe('docs section H is declared once, in shared/docs.ts (docs W1a)', () => {
  const TYPES = ['EntryMode', 'EntryBadge', 'WithheldReason', 'EntryView', 'GithubTarget', 'GithubLink'] as const;
  const FUNCTIONS = ['admitDraft', 'entryView', 'githubBlobUrl'] as const;
  // A type is declared by `type <Name> =` or `interface <Name>`, `export`/`declare` optional:
  // an un-exported local copy is still a copy, and an inline import specifier is not one.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  // A function is declared by `function <name>` or bound by `const|let|var <name>`: an arrow
  // copy is the likeliest second copy, and a call or an import binds nothing.
  const FN_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`, 'm');

  it('CONTROL: the patterns see a declaration, a local copy and an arrow copy, and not an import, a call or another name', () => {
    expect(TYPE_DEF('EntryView').test('export interface EntryView {')).toBe(true);
    expect(TYPE_DEF('EntryBadge').test("type EntryBadge = 'new' | 'deleted';"), 'an un-exported local type').toBe(true);
    expect(TYPE_DEF('EntryView').test("import {\n  type EntryView,\n} from '../../../shared/docs.js';"), 'an import specifier').toBe(false);
    expect(TYPE_DEF('EntryView').test('export interface EntryViewRow {'), 'another name').toBe(false);
    expect(FN_DEF('entryView').test('export function entryView(e: DocsEntry, d: DraftsFacts, mode: EntryMode): EntryView {')).toBe(true);
    expect(FN_DEF('entryView').test('const entryView = (e: DocsEntry) => e;'), 'an arrow copy').toBe(true);
    expect(FN_DEF('entryView').test("import { entryView } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(FN_DEF('entryView').test("  const v = entryView(e, drafts, 'ref');"), 'a call').toBe(false);
    expect(FN_DEF('githubBlobUrl').test('export function githubBlobUrls('), 'another name').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => TYPE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
  for (const name of FUNCTIONS) {
    it(`defines ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => FN_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
});

// Docs W1a, Task 5 (spec 2026-10-01 3.1, 3.2, 3.8): the page grammar, the pin and the one docs API URL builder
// are declared once, in shared/docs.ts. The server's L1 query parser (W2) and the PWA's router and loaders (W5)
// import them; a second parser or builder is a second grammar nothing forces to agree. The marker header word
// is quoted once for the same reason: the server's provenance hook and the PWA's funnel must read the one
// constant, so a rename cannot leave one side sending a header the other no longer checks. DOCS_PAGE_PREFIX's
// own pin is M7.3, in docs-parity.test.ts. APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line.
describe('docs page URLs and the API URL builder are declared once, in shared/docs.ts (docs W1a)', () => {
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
  const TYPES = ['DocsPageLocation', 'DocsPageParseFailure', 'DocsPageParse', 'DocPin'] as const;
  const VALUES = [
    'DOCS_PAGE_PREFIX', 'DOCS_API_PREFIX', 'DOCS_REQUEST_HEADER', 'DOCS_REQUEST_HEADER_VALUE', 'DOCS_PAGE_KEYS',
    'DOCS_PIN_KEYS', 'docsApi',
  ] as const;
  const FUNCTIONS = ['parseDocsPage', 'docsPageUrl'] as const;

  it('CONTROL: each pattern sees a declaration, local or exported, and not an import, a re-export or a use', () => {
    expect(TYPE_DEF('DocPin').test('type DocPin = { kind: string };'), 'un-exported local type').toBe(true);
    expect(TYPE_DEF('DocPin').test("import {\n  type DocPin,\n} from '../../../shared/docs.js';"), 'import specifier').toBe(false);
    expect(VALUE_DEF('docsApi').test('const docsApi = {};'), 'un-exported local const').toBe(true);
    expect(VALUE_DEF('docsApi').test("export { docsApi } from '../../shared/docs.js';"), 're-export').toBe(false);
    expect(VALUE_DEF('docsApi').test('const url = docsApi.tree(p, null);'), 'a use').toBe(false);
    expect(FUNCTION_DEF('parseDocsPage').test('function parseDocsPage(p: string) {}'), 'local function').toBe(true);
    expect(FUNCTION_DEF('parseDocsPage').test('const r = parseDocsPage(path, search);'), 'a call').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares the type ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => TYPE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }

  it('declares every constant and builder exactly once, in shared/docs.ts', () => {
    for (const name of VALUES) {
      expect(ALL.filter((f) => VALUE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/docs.ts']);
    }
    for (const name of FUNCTIONS) {
      expect(ALL.filter((f) => FUNCTION_DEF(name).test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/docs.ts']);
    }
  });

  const HEADER_LITERAL = /(['"])x-ccrc-docs\1/;

  it('CONTROL: the header literal scan sees a quoted copy, and not prose or a longer word', () => {
    expect(HEADER_LITERAL.test("headers['x-ccrc-docs']")).toBe(true);
    expect(HEADER_LITERAL.test('headers: { "x-ccrc-docs": "1" }')).toBe(true);
    expect(HEADER_LITERAL.test('the `x-ccrc-docs` marker'), 'a backticked prose mention').toBe(false);
    expect(HEADER_LITERAL.test("'x-ccrc-docs-v2'"), 'another word').toBe(false);
  });

  it('quotes the marker header word in shared/docs.ts and nowhere else across the four roots', () => {
    expect(ALL.filter((f) => HEADER_LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
  });
});

// Docs W1 final review (minors-triage MT-1): Task 1's sections and grammar predicates, its ref spec and its two
// types, declared once in shared/docs.ts (the plan's pattern 2 for each type or function name). W2's L1 query parser
// and W5's link code call these; a second `isDocsRelPath` (a regex alone, without the category, byte and depth
// checks) would pass every grammar pin while the TS-to-python parity measured a copy no server ran. APPENDED after
// the file's last line: `session-hook.test.ts`'s citation audit cites this file by line.
describe('docs sections, grammar predicates and ref spec are declared once, in shared/docs.ts (docs W1, Task 1)', () => {
  const TYPES = ['DocSectionSlug', 'DocsRefSpec'] as const;
  const FUNCTIONS = [
    'isDocsSection', 'docRepoPath', 'isDocsProject', 'isDocsBareRef', 'isDocsQualifiedRef', 'isDocsCommit',
    'isDocsRelPath', 'isDocsFingerprint', 'isDocsMaxBytes', 'parseDocsRef', 'docsRefText',
  ] as const;
  // Section H's shapes: a type by `type <Name> =` or `interface <Name>`, a function by `function <name>` or a
  // `const|let|var <name>` binding (an arrow copy), `export`/`declare` optional.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const FN_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`, 'm');

  it('CONTROL: the patterns see a declaration, a local copy and an arrow copy, and not an import, a call or another name', () => {
    expect(TYPE_DEF('DocsRefSpec').test("export type DocsRefSpec = { kind: 'bare'; name: string };")).toBe(true);
    expect(TYPE_DEF('DocSectionSlug').test("type DocSectionSlug = 'specs';"), 'an un-exported local type').toBe(true);
    expect(TYPE_DEF('DocsRefSpec').test("import {\n  type DocsRefSpec,\n} from '../../../shared/docs.js';"), 'an import specifier').toBe(false);
    expect(FN_DEF('isDocsRelPath').test('export function isDocsRelPath(s: string): boolean {')).toBe(true);
    expect(FN_DEF('isDocsRelPath').test('const isDocsRelPath = (s: string): boolean => /^x$/.test(s);'), 'an arrow copy').toBe(true);
    expect(FN_DEF('isDocsRelPath').test("import { isDocsRelPath } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(FN_DEF('isDocsRelPath').test('  if (!isDocsRelPath(p)) return null;'), 'a call').toBe(false);
    expect(FN_DEF('isDocsSection').test('export function isDocsSectionSlug('), 'another name').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares the type ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => TYPE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
  for (const name of FUNCTIONS) {
    it(`defines ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => FN_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
});

// SESSION-CONTINUITY WAVE 4 (spec §5.6, the coordinator's safety ruling). APPENDED, for the reason the stall-watch
// blocks above state: `session-hook.test.ts`'s citation audit cites this file by line.
describe('the pane-scope sweep: its arming file has no writer in the tree', () => {
  // `scope-sweep-live` arms `ccd-scope-sweep`'s stop: without it every inert scope is only recorded `would-stop`.
  // Like `stall-watch-live` the operator touches and removes it by hand, so the ONE line of shell that may name
  // it is the sweep's own read, no TypeScript names it at all, and no other file under ccd/ or deploy/ does on a
  // code line. KNOWN WIDTH: a name assembled from pieces is not seen; the bar is the ordinary copy.
  it('scope-sweep-live: one shell holder, ccd/ccd-scope-sweep, whose one line is a read; no TS holder', () => {
    expect(holdersOf('scope-sweep-live'), 'a line of shell other than the sweep names it — a writer in waiting').toEqual(['ccd/ccd-scope-sweep']);
    expect(codeLines(path.join(ccrcRoot, 'ccd', 'ccd-scope-sweep')).filter((l) => l.includes('scope-sweep-live')))
      .toEqual(['[ -e "$REG/scope-sweep-live" ] && MODE=live']);
    expect(ALL.filter((f) => stallCode(f).includes('scope-sweep-live')).map(rel)).toEqual([]);
  });

  // A writer need not be shell: every OTHER file under ccd/ and deploy/ — Python, .mjs, a unit file's
  // `ExecStartPre=` — is read on its non-comment lines too (`#`, `//`, `*` and `/*` lines dropped; Markdown,
  // which is prose, skipped).
  const nonShell = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? nonShell(p) : (BASH.includes(p) || p.endsWith('.md') ? [] : [p]);
  });
  it('scope-sweep-live: no other file under ccd/ or deploy/ names it on a code line — no Python, .mjs or unit-file writer', () => {
    const others = bashRoots.flatMap(nonShell);
    expect(others.length, 'the walk reached the non-shell files').toBeGreaterThan(40);
    expect(others.filter((f) => readFileSync(f, 'utf8').split('\n')
      .some((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l) && l.includes('scope-sweep-live'))).map(rel)).toEqual([]);
  });
});

// WORKSPACE LIFECYCLE WAVE 3b (spec 2026-09-24 §5.3, the coordinator's safety ruling (E)). APPENDED, for the reason
// the stall-watch blocks above state: `session-hook.test.ts`'s citation audit cites this file by line. The expiry lane
// SHIPS SHADOWED: until `$REG/expire-lane-live` exists it audits and records "would expire" and never composes
// `ws-expire`. The file is the operator's to touch BY HAND on the fleet box, beside `stall-watch-live` above — so no
// line of shell names it (a writer, or a reader the design never had), and its one TS holder is its definer, an L1
// file that reaches no `node:` module and so cannot write it.
describe('workspace lifecycle wave 3b: the expiry lane’s live switch has no writer in the tree', () => {
  const NAME = 'expire-lane-live';
  const DEFINER = 'server/src/archivedExpiry.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER: a file that imports the switch's ONE spelling, `EXPIRE_LANE_LIVE_MARKER`, and holds an `io` could
  // write it without ever spelling its name. So the files whose code names the constant are pinned, and none of them
  // may reach a write — the executor reads the registry listing and nothing else. KNOWN WIDTH, stated: a write through
  // a helper defined in another file is not seen; the bar is the ordinary call.
  it('the files that name its constant are the definer and the executor, and neither reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('EXPIRE_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual([DEFINER, 'server/src/coord/expireArchived.ts']);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});

// THE THRESHOLD IS NEVER TYPED BY THE SERVER (the coordinator's ruling (C), wave 3b): ccd's `ws-audit --expire`
// document carries `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`), and the server reads it through ONE reader. Both
// halves pinned: no seven-day literal in the server or the PWA beside the one that is not an expiry (`limits.ts`'s
// usage window), and the audit document is parsed in one place and its `expiresAt` key read in one file. KNOWN WIDTH:
// a reader spelling `doc.expiresAt` on a raw document is not seen — the raw document reaches the server only through
// `parseExpireAudit`, whose one caller is pinned.
describe('workspace lifecycle wave 3b: the expiry threshold is ccd’s, read through one reader', () => {
  const SEVEN_DAYS = /\b604_?800\b|\b7\s*\*\s*86_?400\b|\b7\s*\*\s*24\s*\*\s*60\b/;
  const lane = ALL.filter((f) => /^(server|pwa)\/src\//.test(rel(f)));

  it('no seven-day literal in server/src or pwa/src, but the usage window’s', () => {
    expect(SEVEN_DAYS.test('const S = 7 * 86_400;'), 'CONTROL').toBe(true);
    expect(lane.filter((f) => SEVEN_DAYS.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/limits.ts']);
  });

  it('the audit document is parsed in one place, and its `expiresAt` key is read in one file', () => {
    expect(ALL.filter((f) => /\bparseExpireAudit\s*\(/.test(stallCode(f))).map(rel).sort())
      .toEqual(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts']);
    expect(ALL.filter((f) => /['"]expiresAt['"]/.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/archivedExpiry.ts']);
  });
});

// WORKSPACE LIFECYCLE WAVE 4 (review 313, F3). APPENDED, for the reason the blocks above state. The seven-day pin above
// reads numeric spellings only, so the expiry lane's operator text typed "past its seven days" and nothing reddened.
// MEASURED before deciding how wide: a prose pin over every code line of `server/src` and `pwa/src` holds five files —
// `wsaudit.ts` (ccd's own `not-expired` and `child` sentences, rendered verbatim), `watch.ts` and `coord/schema.ts`
// (the deviation ledger's unrelated seven-day stale window, in a log line and a migration's SQL comment), and the PWA's
// two archive confirms, which are the operator's copy. So the pin is scoped to the lane's own two files, where a
// period in a sentence is the defect.
describe('workspace lifecycle wave 4: the expiry lane’s own words type no period (review 313, F3)', () => {
  const PROSE = /\b(?:seven|7)[ -]days?\b/i;
  it('no seven-day prose on a code line of archivedExpiry.ts or coord/expireArchived.ts', () => {
    expect(PROSE.test('`held (“x”) past its seven days`'), 'CONTROL').toBe(true);
    expect(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts']
      .filter((f) => PROSE.test(stallCode(path.join(ccrcRoot, f))))).toEqual([]);
  });
});

// WORKSPACE LIFECYCLE WAVE 4 (spec 2026-09-24 §5.4, the coordinator's safety ruling (B)). APPENDED, for the reason the
// blocks above state. The dead-coordinator lane SHIPS SHADOWED: until `$REG/dead-coordinator-lane-live` exists it
// measures, anchors, trips its breaker and records "would end programme <slug> (<n> runs)", and never reaches
// `closeRun`'s abandon arm. The file is the operator's to touch BY HAND in the registry the server reads, beside
// `expire-lane-live`, `scope-sweep-live` and `stall-watch-live` above — so no line of shell names it, and its one TS
// holder on a code line is its definer, an L1 file that reaches no `node:` module and so cannot write it.
describe('workspace lifecycle wave 4: the dead-coordinator lane’s live switch has no writer in the tree', () => {
  const NAME = 'dead-coordinator-lane-live';
  const DEFINER = 'server/src/deadCoordinator.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER, the expiry pin's argument: a file that imports the ONE spelling and holds an `io` could write it
  // without spelling its name. The files whose code names the constant are pinned, and none of them reaches a write.
  it('the files that name its constant are the definer and the executor, and neither reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('DEAD_COORDINATOR_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/coord/endDeadCoordinator.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});

// CCRC HISTORY (spec 2026-10-05 §9.11 O13, O14; §10.1 Seams). APPENDED after the last describe, for the reason
// the blocks above state: session-hook.test.ts's citation audit cites this file by line, so no import line is
// added at the head either — the history modules are imported dynamically inside each case.
const HISTORY_DIR = path.join(ccrcRoot, 'ccd', 'history');
/** Every `.mjs` under a root: never a `.d.mts` (a type mirror declares types, it defines nothing), and the
 *  `__`-prefixed mutants and node_modules skipped — the MODELS_CORPUS walk, restated because that one is scoped
 *  to its own describe. */
const mjsUnder = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e.startsWith('__') || e === 'node_modules') continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...mjsUnder(p)); continue; }
    if (/\.mjs$/.test(p)) out.push(p);
  }
  return out;
};
const HISTORY_MJS = mjsUnder(HISTORY_DIR);
/** Any `.mjs` a writer could live in: ccd/ (compact-card and history), deploy/, shared/. */
const ALL_MJS = [...new Set([...mjsUnder(path.join(ccrcRoot, 'ccd')), ...mjsUnder(path.join(ccrcRoot, 'deploy')),
  ...mjsUnder(path.join(ccrcRoot, 'shared'))])];

describe('ccrc history: the operator switches have readers only (spec 2026-10-05 §9.11 O13)', () => {
  // Each switch is touched and removed BY HAND (§9.7): no line of shell or .mjs may write one. `lib.mjs`'s
  // SWITCHES is the one sanctioned definer (the stall-watch MARKERS precedent above); the hook and the shim read
  // `history-off` with a bash test. `_uninst_purge` spells its kept set as the globs `history` and `history-*`
  // and doctor names the cap file from `status --json`, so neither is a holder. B2 adds the skill's files to
  // this corpus with the skill. KNOWN WIDTH: a name assembled from pieces is not seen. ONE named allowance
  // (USAGE_PROSE below, FU5) lets `ccrc --help` spell the pause path as prose; it covers one function's lines
  // and nothing else, and a split spelling is pinned by the case that reads the literal back.
  // `recall-off/<id>` is O13's seventh name and is NOT in HOLDERS: spec O13 gives it exactly one writer,
  // `sweep.mjs` (`--op recall-off`, spec :1863 and the :2007 lifecycle row), which ships in W2. B1 holds the half
  // it can: the last case below reds when any corpus file but `ccd/history/sweep.mjs` writes it. The other half,
  // that `sweep.mjs` DOES write it and is the only file naming it, lands with W2's `--op recall-off`: W2 adds
  // `recall-off` to this describe's holders as `['recall-off', ['ccd/history/sweep.mjs']]` and drops the
  // exemption below.
  const HOLDERS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['history-off', ['ccd/ccd-history-sweep', 'ccd/history/lib.mjs', 'ccd/session-hook.sh']],
    ['history-steer-off', ['ccd/history/lib.mjs']],
    ['history-steer-live', ['ccd/history/lib.mjs']],
    ['history-max-gb', ['ccd/history/lib.mjs']],
    ['steer-on', ['ccd/history/lib.mjs']],
    ['headless-on', ['ccd/history/lib.mjs']],
  ];
  const CORPUS = [...new Set([...BASH, ...ALL_MJS])];
  /** A switch is a PATH, so a line names one only as `/<name>`. The bare words are vocabulary, not files: the
   *  exit-2 reason `history-off` (REASONS, Task 3; decideOpGate's refusal, Task 6) names the CONDITION, and
   *  lib.mjs spells it as a reason word, never as the file. */
  const needle = (name: string): string => `/${name}`;
  /** The help text NAMES the pause path for the operator; it neither reads nor writes the switch. The allowance is
   *  line-scoped: only the lines of `fn`'s body (its `fn() {` line to the next line that is exactly `}`) that hold a
   *  needle in a single-quoted printf argument: a quoted line that belongs to the run of `\` continuations starting at
   *  a `printf` line of `fn` (FU9, B4M2), so a continuation of any other command inside `fn` is not covered. Every
   *  other `file` line naming the path still reds the scan. The allowance departs from spec O13: D-4550. */
  const USAGE_PROSE = { file: 'ccd/ccrc', fn: '_usage_history_paragraph', needles: ['/history-off'] } as const;
  /** The line numbers of `fn`'s body the allowance covers, and the body itself (null when `fn` is not found). */
  const usageProse = (text: string): { body: string[] | null; allowed: Set<number> } => {
    const lines = text.split('\n');
    const at = lines.indexOf(`${USAGE_PROSE.fn}() {`);
    if (at < 0) return { body: null, allowed: new Set() };
    let end = at + 1;
    while (end < lines.length && lines[end] !== '}') end += 1;
    const allowed = new Set<number>();
    let inPrintf = false;   // true while the previous line was a printf line, or a quoted argument line, that ends in `\`
    for (let i = at + 1; i < end; i += 1) {
      const l = lines[i]!;
      const continues = /\\\s*$/.test(l);
      if (/^\s*printf\b/.test(l)) { inPrintf = continues; continue; }
      const m = /^\s*'([^']*)'(?:\s*\\)?$/.exec(l);
      if (inPrintf && m && USAGE_PROSE.needles.some((n) => m[1]!.includes(n))) allowed.add(i);
      inPrintf = inPrintf && m !== null && continues;
    }
    return { body: lines.slice(at + 1, end), allowed };
  };
  /** A file's code lines, comment lines dropped in either language. The one allowance is applied here, so the
   *  holder count and the `writes()` classifier both skip it. */
  const code = (f: string): string[] => {
    if (!BASH.includes(f)) return stallCode(f).split('\n');
    const text = readFileSync(f, 'utf8');   // once per call: ccd/ccrc is about 24k lines
    const skip = rel(f) === USAGE_PROSE.file ? usageProse(text).allowed : new Set<number>();
    return text.split('\n').filter((l, i) => !skip.has(i) && !isBashComment(l));
  };
  /** A line READS a switch when it tests or reads the path. */
  const READ = /\[\[?\s+!?\s*-[efrs]\s|\b(?:existsSync|readFileSync|statSync|lstatSync)\s*\(/;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** A line WRITES the switch when a redirection, a file-changing command or a writing fs call targets it. */
  const writes = (line: string, lang: 'bash' | 'mjs', name: string): boolean => {
    const n = esc(name);
    if (lang === 'mjs') {
      return new RegExp(`\\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\\s*\\([^;]*${n}`).test(line);
    }
    const l = line.replace(/\d?>\s*\/dev\/null|>&\d/g, '');
    return new RegExp(`>{1,2}\\s*["']?[^\\s"'<>|;&]*${n}`).test(l)
      || new RegExp(`(?:^|[\\s;&|({])(?:touch|mv|cp|ln|rm|rmdir|mkdir|install|tee|truncate)\\s[^;&|]*${n}`).test(l);
  };
  /** lib.mjs's SWITCHES declaration: its first line through the line that closes it. */
  const switchesBlock = (): string[] => {
    const lines = stallCode(path.join(HISTORY_DIR, 'lib.mjs')).split('\n');
    const at = lines.findIndex((l) => /\bconst SWITCHES\s*=/.test(l));
    expect(at, 'ccd/history/lib.mjs declares no SWITCHES').toBeGreaterThan(-1);
    let end = at;
    while (end < lines.length - 1 && !/\}\s*\)\s*;?\s*$/.test(lines[end]!)) end += 1;
    return lines.slice(at, end + 1);
  };

  it('CONTROL: both corpora were walked, and the classifiers see a read, a write and neither', () => {
    expect(BASH.map(rel)).toEqual(expect.arrayContaining(['ccd/ccd-history-sweep', 'ccd/session-hook.sh']));
    expect(ALL_MJS.map(rel)).toContain('ccd/history/lib.mjs');
    expect(READ.test('[ -e "$HOME/.ccrc/history-off" ] && exit 0')).toBe(true);
    expect(READ.test('[[ ! -e "$HOME/.ccrc/history-off" ]] || _hs=x')).toBe(true);
    expect(READ.test('if (existsSync(p.off)) return 0;')).toBe(true);
    expect(writes('touch "$HOME/.ccrc/history-off"', 'bash', 'history-off')).toBe(true);
    expect(writes(': > "$HOME/.ccrc/history-off"', 'bash', 'history-off')).toBe(true);
    expect(writes('rm -f -- "$HOME/.ccrc/history-max-gb"', 'bash', 'history-max-gb')).toBe(true);
    expect(writes('[ -e "$HOME/.ccrc/history-off" ] 2>/dev/null', 'bash', 'history-off')).toBe(false);
    expect(writes('[[ -e "$HOME/.ccrc/history-off" ]] || { printf x >> "$spool"; }', 'bash', 'history-off')).toBe(false);
    expect(writes("writeFileSync(home + '/.ccrc/history-off', '')", 'mjs', 'history-off')).toBe(true);
    expect(writes("if (existsSync(home + '/.ccrc/history-off')) return;", 'mjs', 'history-off')).toBe(false);
    // The reason word is not the file: REASON_ROWS' `'history-off'` names no switch path.
    expect("'irreversible-in-pane', 'history-off', 'span-pruned',".includes(needle('history-off'))).toBe(false);
    expect('[ -e "$HOME/.ccrc/history-off" ] && exit 0'.includes(needle('history-off'))).toBe(true);
  });

  it('USAGE_PROSE: the allowance covers one real spelling, the literal path, and exactly one line (FU5)', () => {
    const text = readFileSync(path.join(ccrcRoot, USAGE_PROSE.file), 'utf8');
    const { body, allowed } = usageProse(text);
    expect(body, `${USAGE_PROSE.file} has no ${USAGE_PROSE.fn}`).not.toBeNull();
    // A split spelling (`local off=history-off`, `~/.ccrc/$off`) would hold no needle and so pass the scan blind:
    // the help text must carry the path whole, so a future split fails here.
    expect(body!.join('\n')).toContain('~/.ccrc/history-off');
    expect(allowed.size).toBe(1);
    // The classifier: a single-quoted prose line is allowed, a code line that reads or writes the path is not.
    const probe = (...l: string[]): number => usageProse(`${USAGE_PROSE.fn}() {\n${l.join('\n')}\n}\n`).allowed.size;
    const PROSE = "    '            a session printed included; touch ~/.ccrc/history-off to pause' \\";
    expect(probe("  printf '\\n%s' \\", PROSE)).toBe(1);
    expect(probe(PROSE), 'a quoted line outside a printf run is not prose').toBe(0);
    // FU9 (B4M2): a quoted line is covered only as the continuation of a printf line, never of another command.
    expect(probe('  touch \\', "    '/abs/.ccrc/history-off'")).toBe(0);
    expect(probe("  printf '\\n%s' \\", "    'one' \\", '  touch \\', "    '/abs/.ccrc/history-off'")).toBe(0);
    expect(probe("  printf '\\n%s' \\", "    'one'", "    '/abs/.ccrc/history-off'"), 'a quoted line with no `\\` ends the run').toBe(0);
    expect(probe('    touch "$HOME/.ccrc/history-off"')).toBe(0);
    expect(probe('    [ -e "$HOME/.ccrc/history-off" ] && return 0')).toBe(0);
  });

  it('SWITCHES names every switch, so the rows below compare against a real definer', () => {
    const block = switchesBlock().join('\n');
    for (const [name] of HOLDERS) expect(block, `SWITCHES does not name ${name}`).toContain(name);
  });

  it.each(HOLDERS)('%s: named on a code line only by its declaration and its readers %j, and never written', (name, want) => {
    const holders = CORPUS.filter((f) => code(f).some((l) => l.includes(needle(name)))).map(rel).sort();
    expect(holders, `${name}: a new line names it — a writer, or a reader this design does not list`).toEqual([...want].sort());
    const block = switchesBlock();
    for (const f of CORPUS.filter((x) => want.includes(rel(x)))) {
      const naming = code(f).filter((l) => l.includes(needle(name)));
      if (rel(f) === 'ccd/history/lib.mjs') {
        expect(naming.filter((l) => !block.includes(l)), `${name}: lib.mjs names it outside SWITCHES`).toEqual([]);
        continue;
      }
      const lang = BASH.includes(f) ? 'bash' : 'mjs';
      for (const l of naming) {
        expect(READ.test(l), `${rel(f)}: \`${l.trim()}\` names ${name} and reads nothing`).toBe(true);
        expect(writes(l, lang, name), `${rel(f)}: \`${l.trim()}\` WRITES ${name}`).toBe(false);
      }
    }
  });

  it('recall-off/<id>: no corpus file but sweep.mjs writes it (B1 holds this half; W2 adds sweep.mjs as its one writer)', () => {
    const W2_WRITER = 'ccd/history/sweep.mjs';
    // CONTROL: the writer shapes this describe classifies are seen against this name too.
    expect(writes('touch "$H/recall-off/$id"', 'bash', 'recall-off')).toBe(true);
    expect(writes("writeFileSync(path.join(dir, 'recall-off', id), gen)", 'mjs', 'recall-off')).toBe(true);
    expect(writes("if (existsSync(home + '/.ccrc/history/recall-off/' + id)) return;", 'mjs', 'recall-off')).toBe(false);
    const writers = CORPUS.filter((f) => rel(f) !== W2_WRITER)
      .filter((f) => code(f).some((l) => l.includes('recall-off') && writes(l, BASH.includes(f) ? 'bash' : 'mjs', 'recall-off')))
      .map(rel).sort();
    expect(writers, 'recall-off/<id> has exactly one writer, sweep.mjs (spec O13): a write here is a second one').toEqual([]);
  });
});
describe('ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses (spec 2026-10-05 §9.11 O14)', () => {
  const LIB = path.join(HISTORY_DIR, 'lib.mjs');
  const VOCABS = ['NODE_KINDS', 'PARSE_STATUS', 'PROVENANCE', 'SPOOL_EVENTS', 'EPOCH_CAUSES', 'REFUSALS', 'ERROR_CODES',
    'COVERAGE', 'SCOPE_SOURCES', 'VARIANT_CAUSES', 'BACKENDS', 'HARNESS_TABLE', 'HARNESSES', 'JOURNAL_KINDS',
    'JOURNAL_VERDICTS', 'BIND_KINDS', 'MIGRATION_VERDICTS', 'HEALTH_WORDS', 'REASONS', 'WRITING_FORMS', 'STORE_FILES',
    'PASS_WORDS', 'CARD_PREFIX', 'SWITCHES', 'EXIT'] as const;
  /** The declaration scan's corpus: the history modules and every deploy/ and shared/ `.mjs`. NOT the rest of
   *  ccd/: `ccd/compact-card.mjs` declares an `EXIT` of its own (its exit codes, a different module's). */
  const DECL_CORPUS = [...new Set([...HISTORY_MJS, ...mjsUnder(path.join(ccrcRoot, 'deploy')), ...mjsUnder(path.join(ccrcRoot, 'shared'))])];
  const declares = (name: string): RegExp => new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`);
  /** The `"ev":"…"` literals a bash file writes, and the `ev: '…'` keys a `.mjs` file builds. */
  const EV_BASH = /"ev":"([A-Za-z]+)"/g;
  const EV_MJS = /\bev\s*:\s*['"`]([A-Za-z]+)['"`]/g;
  /** SPOOL_EVENTS members whose emitter ships in a later PR. A member found emitted while listed here reds, so
   *  the PR that adds the emitter removes its line. */
  const PENDING_EMITTERS: Record<string, string> = { recall: 'B2 (cli.mjs read verbs)', steer: 'W3 (the steering hook)' };
  type Lib = Record<string, unknown>;
  const lib = async (): Promise<Lib> => (await import('../../ccd/history/lib.mjs')) as unknown as Lib;

  it('CONTROL: the corpus holds the four history modules, and the declaration pattern sees a declaration and nothing else', () => {
    expect(HISTORY_MJS.map(rel).sort()).toEqual(expect.arrayContaining(
      ['ccd/history/cli.mjs', 'ccd/history/lib.mjs', 'ccd/history/store.mjs', 'ccd/history/sweep.mjs']));
    expect(declares('BACKENDS').test("export const BACKENDS = Object.freeze(['anthropic', 'other', 'unknown']);")).toBe(true);
    expect(declares('BACKENDS').test('const BACKENDS = x;')).toBe(true);
    expect(declares('BACKENDS').test('if (BACKENDS.includes(b)) return b;')).toBe(false);
    expect(declares('BACKENDS').test("const { BACKENDS } = await import('./lib.mjs');")).toBe(false);
    expect(declares('EXIT').test('export const EXIT_CODES = 1;')).toBe(false);
  });

  it.each(VOCABS)('%s is declared in ccd/history/lib.mjs and in no other .mjs, exported, and frozen', async (name) => {
    expect(DECL_CORPUS.filter((f) => stallCode(f).split('\n').some((l) => declares(name).test(l))).map(rel).sort(),
      `${name}: a second declaration`).toEqual(['ccd/history/lib.mjs']);
    const v = (await lib())[name];
    expect(v, `${name} is not exported`).toBeDefined();
    if (typeof v === 'object' && v !== null) expect(Object.isFrozen(v), `${name} is not frozen`).toBe(true);
  });

  it('REFUSALS is REASONS\' exit-2 keys and HARNESSES is HARNESS_TABLE\'s keys, each derived, never declared apart', async () => {
    const l = await lib();
    const reasons = l['REASONS'] as Record<string, number>;
    const exits = Object.values(l['EXIT'] as Record<string, number>);
    for (const [w, x] of Object.entries(reasons)) expect(exits, `REASONS.${w} = ${x} is not an EXIT value`).toContain(x);
    expect([...(l['REFUSALS'] as readonly string[])].sort())
      .toEqual(Object.keys(reasons).filter((k) => reasons[k] === 2).sort());
    expect([...(l['HARNESSES'] as readonly string[])]).toEqual(Object.keys(l['HARNESS_TABLE'] as object));
    const src = stallCode(LIB).split('\n');
    expect(src.find((x) => declares('HARNESSES').test(x)), 'HARNESSES is spelled, not derived').toContain('Object.keys(HARNESS_TABLE)');
    expect(src.find((x) => declares('REFUSALS').test(x)), 'REFUSALS is spelled, not derived').toContain('Object.keys(REASONS)');
  });

  it('every "ev" the hook writes is a SPOOL_EVENTS member, and every member has an emitter or is named pending', async () => {
    const members = [...((await lib())['SPOOL_EVENTS'] as readonly string[])];
    const hook = codeLines(path.join(ccrcRoot, 'ccd', 'session-hook.sh')).join('\n');
    const fromHook = [...hook.matchAll(EV_BASH)].map((m) => m[1]!);
    const fromMjs = HISTORY_MJS.flatMap((f) => [...stallCode(f).matchAll(EV_MJS)].map((m) => m[1]!));
    expect(fromHook.length, 'the hook scan matched nothing — the spool block is gone or its spelling moved').toBeGreaterThan(0);
    for (const e of [...fromHook, ...fromMjs]) expect(members, `"${e}" is written but is not a SPOOL_EVENTS member`).toContain(e);
    const emitted = new Set([...fromHook, ...fromMjs]);
    for (const k of Object.keys(PENDING_EMITTERS)) expect(members, `PENDING_EMITTERS names ${k}, not a member`).toContain(k);
    for (const m of members) {
      if (m in PENDING_EMITTERS) expect(emitted.has(m), `${m} has an emitter now: remove it from PENDING_EMITTERS`).toBe(false);
      else expect(emitted.has(m), `${m} is a SPOOL_EVENTS member with no emitter`).toBe(true);
    }
  });

  it('every kind the sweep journals is a JOURNAL_KINDS member', async () => {
    const members = [...((await lib())['JOURNAL_KINDS'] as readonly string[])];
    const CALL = /\bjournalRecord\(\s*['"`]([a-z-]+)['"`]/g;
    const kinds = HISTORY_MJS.flatMap((f) => [...stallCode(f).matchAll(CALL)].map((m) => [rel(f), m[1]!] as const));
    expect(kinds.length, 'no journalRecord call names its kind as a literal — the scan saw nothing').toBeGreaterThan(0);
    expect(kinds.filter(([, k]) => !members.includes(k)).map(([f, k]) => `${f}: ${k}`)).toEqual([]);
  });

  it('every word _check_history spells is a HEALTH_WORDS member, every class is pass|warn|fail, and every remedy is keyed by a word', async () => {
    const l = await lib();
    const words = Object.keys(l['HEALTH_WORDS'] as object);
    for (const c of Object.values(l['HEALTH_WORDS'] as Record<string, string>)) expect(['pass', 'warn', 'fail']).toContain(c);
    for (const k of Object.keys(l['HEALTH_REMEDIES'] as object)) expect(words, `HEALTH_REMEDIES keys ${k}`).toContain(k);
    const lines = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'), 'utf8').split('\n');
    const at = lines.findIndex((x) => /^_check_history\(\) \{$/.test(x));
    expect(at, 'ccd/ccrc-doctor-checks has no _check_history').toBeGreaterThan(-1);
    const end = lines.findIndex((x, i) => i > at && x === '}');
    const body = lines.slice(at, end).filter((x) => !x.trim().startsWith('#')).join('\n');
    const spelled = [...body.matchAll(/_dr_(?:pass|warn|fail)\s+history\s+"([a-z][a-z0-9-]*):/g)].map((m) => m[1]!);
    expect(spelled.length, 'the scan matched no word in _check_history').toBeGreaterThan(0);
    expect(spelled.filter((w) => !words.includes(w))).toEqual([]);
  });

  it('the literal .ccrc/history/db is spelled in ccd/history/*.mjs once, as STORE_DB_REL', async () => {
    expect((await lib())['STORE_DB_REL']).toBe('.ccrc/history/db');
    expect(HISTORY_MJS.filter((f) => stallCode(f).includes('.ccrc/history/db')).map(rel)).toEqual(['ccd/history/lib.mjs']);
    const lines = stallCode(LIB).split('\n').filter((x) => x.includes('.ccrc/history/db'));
    expect(lines, 'lib.mjs spells the store directory more than once').toHaveLength(1);
    expect(lines[0]).toMatch(/\bSTORE_DB_REL\s*=\s*['"]\.ccrc\/history\/db['"]/);
  });

  it('COVERAGE is this-box, and the word is a literal in lib.mjs alone; CARD_PREFIX is declared (its hook half lands in B3)', async () => {
    const l = await lib();
    expect([...(l['COVERAGE'] as readonly string[])]).toEqual(['this-box']);
    expect(HISTORY_MJS.filter((f) => /['"`]this-box['"`]/.test(stallCode(f))).map(rel)).toEqual(['ccd/history/lib.mjs']);
    expect(l['CARD_PREFIX']).toBe('History: ');
  });

  it('NODE_KINDS is the schema-v1 CHECK list in store.mjs, member for member', async () => {
    const kinds = [...((await lib())['NODE_KINDS'] as readonly string[])];
    const { MIGRATIONS } = await import('../../ccd/history/store.mjs');
    const m = /\bkind IN \(([^)]*)\)/.exec(MIGRATIONS[0] ?? '');
    expect(m, 'schema v1 declares no nodes.kind CHECK').not.toBeNull();
    expect(m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort()).toEqual(kinds.sort());
  });
});
describe('ccrc history: process.env is read by name, from a four-name allow-list (spec 2026-10-05 §10.1 Seams)', () => {
  // D-4247: no env var arms a seam in the shipped modules. A test's faults arrive through
  // a NODE_OPTIONS preload it writes itself, and `process.env` is read only for these four names.
  const ALLOWED = ['CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'];
  const READS = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])?/g;
  const envReads = (code: string): string[] => [...code.matchAll(READS)].map((m) => m[1] ?? m[3] ?? '<not by name>');

  it('CONTROL: the reader names dotted and bracketed reads, and flags a whole-env use and a computed name', () => {
    expect(envReads("const h = process.env.HOME; const g = process.env['CCRC_SESSION_GENERATION'];"))
      .toEqual(['HOME', 'CCRC_SESSION_GENERATION']);
    expect(envReads('spawnSync(bin, args, { env: process.env });')).toEqual(['<not by name>']);
    expect(envReads('const v = process.env[name];')).toEqual(['<not by name>']);
  });

  it('every process.env read in ccd/history/*.mjs names an allowed variable', () => {
    const seen = HISTORY_MJS.flatMap((f) => envReads(stallCode(f)).map((n) => [rel(f), n] as const));
    expect(seen.length, 'no history module reads process.env at all — the scan saw nothing').toBeGreaterThan(0);
    expect(seen.filter(([, n]) => !ALLOWED.includes(n)).map(([f, n]) => `${f}: ${n}`)).toEqual([]);
  });
});

// Task 36G item 2 (Task 34's O13): the `.mjs` arm above looks for a switch's PATH TEXT (`/history-off`), and
// the sanctioned spelling in `.mjs` is symbolic — `SWITCHES.off`, or the `off`/`cap` field of a `historyPaths(...)`
// result (`P.off`) — which carries no `/name` at all, so `writeFileSync(P.off, '')` is invisible to it. This arm
// reads the symbols instead. KNOWN WIDTH: an alias of an alias (`const x = P.off; unlinkSync(x)`) is not seen.
describe('ccrc history: no .mjs writes a switch through its symbolic spelling (spec 2026-10-05 §9.11 O13)', () => {
  /** The verb list of the O13 describe's `writes()` for `.mjs`, restated (that one is closed over its describe). */
  const VERB = /\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(/;
  /** `historyPaths` has two switch fields, `off` and `cap`; every other SWITCHES key is named alongside. */
  const symbolic = (keys: readonly string[]): RegExp =>
    new RegExp(`SWITCHES\\.|\\.(?:off|cap|${keys.join('|')})\\b`);
  const writesSymbolically = (line: string, keys: readonly string[]): boolean => {
    const m = VERB.exec(line);
    return m !== null && symbolic(keys).test(line.slice(m.index + m[0].length));
  };
  const KEYS = ['maxGb', 'steerOff', 'steerLivePrefix', 'steerOnDir', 'headlessOn'] as const;

  it('CONTROL: the classifier sees a write through P.off, a historyPaths(...) field and SWITCHES., and not a read', () => {
    expect(writesSymbolically("writeFileSync(P.off, '')", KEYS)).toBe(true);
    expect(writesSymbolically("existsSync(P.off)", KEYS)).toBe(false);
    expect(writesSymbolically("unlinkSync(historyPaths(home).cap);", KEYS)).toBe(true);
    expect(writesSymbolically("fs.writeFileSync(join(home, SWITCHES.maxGb), '9')", KEYS)).toBe(true);
    expect(writesSymbolically("mkdirSync(`${home}/${SWITCHES.steerOnDir}`, { recursive: true })", KEYS)).toBe(true);
    expect(writesSymbolically("rmSync(c.paths.headlessOn)", KEYS)).toBe(true);
    expect(writesSymbolically("if (existsSync(P.off)) return 0;", KEYS)).toBe(false);
    expect(writesSymbolically("const cap = capOf(capText(P.cap));", KEYS)).toBe(false);
  });

  it('SWITCHES keys named here are exactly lib.mjs\'s, so a key added there is not unwatched', async () => {
    const lib = (await import('../../ccd/history/lib.mjs')) as unknown as { SWITCHES: Record<string, string> };
    expect(Object.keys(lib.SWITCHES).sort()).toEqual(['off', ...KEYS].sort());
  });

  it('no line of any .mjs under ccd/, deploy/ or shared/ pairs a write verb with a switch symbol', () => {
    expect(ALL_MJS.map(rel)).toContain('ccd/history/sweep.mjs');
    const hits = ALL_MJS.flatMap((f) => stallCode(f).split('\n')
      .filter((l) => writesSymbolically(l, KEYS)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits, 'a switch is touched and removed by hand (§9.7): a .mjs write through SWITCHES or historyPaths is a writer').toEqual([]);
  });
});

// Docs W2, Task 8 (spec 2026-10-01 M7.10, section 1's ring column): the files under server/src/docs are classified
// by their IMPORTS, never by their path. policy.ts (L1) imports only shared/; ports.ts (L2) is type-only;
// ccdsource.ts (L3) names no fastify, no `reply` and no timer, and imports only from its stated list; only W3's
// routes.ts, hooks.ts, lane.ts and cache.ts (L4) may import fastify or own a timer. A file the table does not name
// is held to L3's rules, so a new file is never an exemption. The file list is read from the directory (`sources`,
// a readdirSync walk), never hand-kept. Every rule reads comment-stripped text (`stallCodeText`), so a sentence
// ABOUT fastify or a timer is never counted as one. APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line, so nothing above may move.
describe('the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10)', () => {
  const docsDir = path.join(ccrcRoot, 'server/src/docs');
  type DocsRing = 'L1' | 'L2' | 'L3' | 'L4';
  /** Each known file's ring. W3's four L4 files are named now, so W3 adding them reds nothing here. */
  const DOCS_RING_ROLES: Readonly<Record<string, DocsRing>> = {
    'policy.ts': 'L1', 'ports.ts': 'L2', 'ccdsource.ts': 'L3',
    'routes.ts': 'L4', 'hooks.ts': 'L4', 'lane.ts': 'L4', 'cache.ts': 'L4',
  };
  /** The files W2 created. A FLOOR, not a count (the update ring's argument): a new file raises it, and a listed
   *  file that is gone reds instead of disarming the scan. */
  const DOCS_RING_FLOOR: readonly string[] = ['policy.ts', 'ports.ts', 'ccdsource.ts', 'routes.ts', 'hooks.ts', 'lane.ts', 'cache.ts'];
  /** What L3 may import (the W2 plan's Global Constraints): its server neighbours, node's hash, its own ring's
   *  policy and ports, and L0. A type import is an import. */
  const L3_IMPORTS: ReadonlySet<string> = new Set([
    '../ccdargv.js', '../lifecycle.js', '../exec.js', '../fleetstate.js', 'node:crypto', './policy.js', './ports.js',
    '../../../shared/docs.js',
  ]);
  /** A fastify import in any of its forms: `from`, a bare `import`, a dynamic `import(...)` or a `require(...)`;
   *  either quote; the package, a subpath, a `fastify-*` package or an `@fastify/*` one. */
  const FASTIFY = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(?:@fastify\/[^'"\n]*|fastify(?:[-/][^'"\n]*)?)\1/;
  const TIMERS = /\b(?:setTimeout|setInterval|setImmediate)\s*\(/;
  const RUNTIME_LOAD = /\bimport\s*\(|\brequire\s*\(/;
  const REPLY = /\breply\b/;
  const L2_RUNTIME_EXPORT = /^\s*export\s+(?:default\b|(?:async\s+)?(?:const|let|var|function|class|abstract|enum)\b|\{|\*)/m;
  /** Every static specifier: `import ... from 'x'`, `export ... from 'x'` and a bare `import 'x'`. */
  const specifiers = (code: string): string[] => [
    ...[...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"\n]+)\1/gm)].map((m) => m[2]),
    ...[...code.matchAll(/^\s*import\s*(['"])([^'"\n]+)\1/gm)].map((m) => m[2]),
  ];
  /** Over `[name, source]` pairs, so the CONTROLs below plant their shapes as text: no fixture directory, and so
   *  no new import line in this file. */
  const ringViolations = (files: readonly (readonly [string, string])[]): string[] =>
    files.flatMap(([name, text]) => {
      const role: DocsRing = DOCS_RING_ROLES[name] ?? 'L3';
      const code = stallCodeText(text);
      const at = `${name} (${role})`;
      const specs = specifiers(code);
      const out: string[] = [];
      if (role !== 'L4' && FASTIFY.test(code)) out.push(`${at} imports fastify`);
      if (role !== 'L4' && TIMERS.test(code)) out.push(`${at} owns a timer`);
      if (role === 'L1') {
        for (const s of specs) if (!/^(?:\.\.\/)+shared\//.test(s)) out.push(`${at} imports ${s}, outside shared/`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      if (role === 'L2') {
        for (const l of code.split('\n')) {
          if (/^\s*import\b/.test(l) && !/^\s*import\s+type\b/.test(l)) out.push(`${at} has a value import: ${l.trim()}`);
        }
        if (L2_RUNTIME_EXPORT.test(code)) out.push(`${at} exports a runtime value`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      if (role === 'L3') {
        if (REPLY.test(code)) out.push(`${at} names reply`);
        for (const s of specs) if (!L3_IMPORTS.has(s)) out.push(`${at} imports ${s}, not on L3's list`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      return out;
    });
  const docsNames = (): string[] => sources(docsDir).map((f) => path.relative(docsDir, f));
  const onDisk = (): (readonly [string, string])[] =>
    docsNames().map((n) => [n, readFileSync(path.join(docsDir, n), 'utf8')] as const);
  /** One live file with one planted line above its own text: the live text is clean, so the answer is exactly what
   *  the planted line breaks. */
  const planted = (name: string, line: string): (readonly [string, string])[] =>
    [[name, `${line}\n${readFileSync(path.join(docsDir, name), 'utf8')}`]];

  it('covers the directory — every floor file is visited by the directory walk (never a hand list)', () => {
    expect(existsSync(docsDir), 'server/src/docs is not on disk — was the directory moved?').toBe(true);
    const names = docsNames();
    for (const f of DOCS_RING_FLOOR) expect(names, `${f} is listed but not visited`).toContain(f);
    expect(names.length).toBeGreaterThanOrEqual(DOCS_RING_FLOOR.length);
  });

  it('the live tree: no file under server/src/docs breaks its ring', () => {
    expect(ringViolations(onDisk())).toEqual([]);
  });

  it('CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer', () => {
    expect(ringViolations(planted('policy.ts', "import fastify from 'fastify';"))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', "import 'fastify';"))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', 'const f = await import("fastify");'))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) loads a module at run time',
    ]);
    expect(ringViolations(planted('policy.ts', "import { readFileSync } from 'node:fs';"))).toEqual([
      'policy.ts (L1) imports node:fs, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', "import type { CcdArgv } from '../ccdargv.js';"))).toEqual([
      'policy.ts (L1) imports ../ccdargv.js, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', 'const t = setTimeout(() => {}, 1);'))).toEqual([
      'policy.ts (L1) owns a timer',
    ]);
  });

  it('CONTROL: L2 (ports.ts) — a value import and each runtime export are caught; a type re-export is not', () => {
    expect(ringViolations(planted('ports.ts', "import { DOCS_CAP } from '../ccdargv.js';"))).toEqual([
      "ports.ts (L2) has a value import: import { DOCS_CAP } from '../ccdargv.js';",
    ]);
    expect(ringViolations(planted('ports.ts', 'export const X = 1;'))).toEqual(['ports.ts (L2) exports a runtime value']);
    expect(ringViolations(planted('ports.ts', 'export function f(): void {}'))).toEqual(['ports.ts (L2) exports a runtime value']);
    expect(ringViolations(planted('ports.ts', "export { DOCS_CAP } from '../ccdargv.js';"))).toEqual([
      'ports.ts (L2) exports a runtime value',
    ]);
    expect(ringViolations(planted('ports.ts', "export type { DocsJob } from './policy.js';"))).toEqual([]);
    expect(ringViolations(planted('ports.ts', 'const m = await import("node:fs");'))).toEqual([
      'ports.ts (L2) loads a module at run time',
    ]);
  });

  it('CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not', () => {
    expect(ringViolations(planted('ccdsource.ts', 'reply.code(500);'))).toEqual(['ccdsource.ts (L3) names reply']);
    expect(ringViolations(planted('ccdsource.ts', 'setTimeout(() => {}, 1);'))).toEqual(['ccdsource.ts (L3) owns a timer']);
    expect(ringViolations(planted('ccdsource.ts', "import type { FastifyReply } from 'fastify';"))).toEqual([
      'ccdsource.ts (L3) imports fastify', "ccdsource.ts (L3) imports fastify, not on L3's list",
    ]);
    expect(ringViolations(planted('ccdsource.ts', "import { readFileSync } from 'node:fs';"))).toEqual([
      "ccdsource.ts (L3) imports node:fs, not on L3's list",
    ]);
    expect(ringViolations(planted('ccdsource.ts', 'const m = await import("node:fs");'))).toEqual([
      'ccdsource.ts (L3) loads a module at run time',
    ]);
    expect(ringViolations(planted('ccdsource.ts', '// reply, setTimeout( and import fastify are named here in prose only'))).toEqual([]);
  });

  it('CONTROL: an L4 file may import fastify and own a timer; an unclassified file is held to L3', () => {
    expect(ringViolations([
      ['routes.ts', "import type { FastifyInstance } from 'fastify';\nexport const t = setTimeout(() => {}, 1);\n"],
    ])).toEqual([]);
    expect(ringViolations([['extra.ts', "import fastify from 'fastify';\n"]])).toEqual([
      'extra.ts (L3) imports fastify', "extra.ts (L3) imports fastify, not on L3's list",
    ]);
    expect(ringViolations([['extra.ts', 'import fastifyStatic from "@fastify/static";\n']])).toEqual([
      'extra.ts (L3) imports fastify', "extra.ts (L3) imports @fastify/static, not on L3's list",
    ]);
  });
});

// Docs W2, Task 8: the names W2 declares, each with ONE home. W3's routes and later waves import them; a second
// declaration would be a second answer that nothing forces to agree. Two directions: a hand-kept table pins each
// W2 name to its file, and a derived scan holds EVERY export under server/src/docs (W3's included, with no list to
// maintain) to exactly one declaration across the four roots. The table is checked against the scan, so the scan
// cannot go blind to a name the table knows. Plus two docs-only spellings: the qualified ref prefixes are derived
// from L0 and never quoted under server/src/docs, and the adapter is the one caller of the docs builders (row 49's
// exact `docsFetch(` count is W3's). APPENDED, for the citation audit's reason above.
describe('docs W2 names are defined once (spec 2026-10-01 section 1, M7.10)', () => {
  const docsDir = path.join(ccrcRoot, 'server/src/docs');
  const POLICY = 'server/src/docs/policy.ts';
  const PORTS = 'server/src/docs/ports.ts';
  const SOURCE = 'server/src/docs/ccdsource.ts';
  const HOMES: Readonly<Record<string, string>> = {
    // policy.ts (L1): values, functions, types.
    DOCS_FAILURE_HTTP: POLICY, DOCS_CAPS_UNKNOWN_RETRY_AFTER_S: POLICY, DOCS_REF_PREFIXES: POLICY,
    DOCS_LANE_EXECS: POLICY, DOCS_LANE_BYTES: POLICY, DOCS_LANE_LARGE_RAW: POLICY, DOCS_LANE_QUEUE: POLICY,
    DOCS_LANE_MAX_WAIT_MS: POLICY, LISTING_JOB: POLICY, DOCS_CACHE_IMMUTABLE: POLICY, DOCS_CACHE_NO_STORE: POLICY,
    DOCS_JSON_CONTENT_TYPE: POLICY,
    docsRetryAfterSeconds: POLICY, docsRefTarget: POLICY, fetchBranchFor: POLICY, refreshDue: POLICY,
    parseDocsApiQuery: POLICY, parseDocsProjectParam: POLICY, parseDocsRefreshBody: POLICY, docsProvenance: POLICY,
    laneAdmit: POLICY, showRawBound: POLICY, showWire: POLICY, docsShowPlan: POLICY, cacheControlFor: POLICY,
    docsSendPolicy: POLICY,
    DocsRefTarget: POLICY, DocsFetchPlan: POLICY, DocsApiRoute: POLICY, DocsApiRequest: POLICY,
    DocsRefreshRequest: POLICY, DocsHeaderBag: POLICY, DocsProvenance: POLICY, DocsJob: POLICY, LaneLoad: POLICY,
    DocsShowPlan: POLICY, DocsSendVerdict: POLICY,
    // ports.ts (L2): types only.
    DocsNodeId: PORTS, DocsSourceId: PORTS, DocsShowAsk: PORTS, DocsIndexRead: PORTS, DocsTreeRead: PORTS,
    DocsShowRead: PORTS, DocsFetchRun: PORTS, DocsReader: PORTS, DocsFetcher: PORTS,
    // ccdsource.ts (L3): the deps type and the two factories.
    CcdDocsDeps: SOURCE, ccdDocsReader: SOURCE, ccdDocsFetcher: SOURCE,
    // Outside server/src/docs: the cap token, and the single reader of killed/signal.
    DOCS_CAP: 'server/src/ccdargv.ts', CcdEnding: 'server/src/lifecycle.ts', ccdEnding: 'server/src/lifecycle.ts',
  };
  /** A declaration of `name` in any of its shapes: a function (async or not), a `const|let|var|class|enum` binding,
   *  a type alias by its `=`, an interface; `export`/`declare` optional. An import, a re-export or a call declares
   *  nothing. */
  const DEF = (name: string): RegExp => new RegExp(
    `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:(?:async\\s+)?function\\s+${name}\\b|(?:const|let|var|class|enum)\\s+${name}\\b|type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`,
    'm');
  /** Every name a file exports by declaration. */
  const exportedNames = (text: string): string[] =>
    [...text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]);
  const text = new Map<string, string>();
  const src = (f: string): string => {
    const hit = text.get(f);
    if (hit !== undefined) return hit;
    const t = readFileSync(f, 'utf8');
    text.set(f, t);
    return t;
  };
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(src(f))).map(rel);
  /** A qualified ref prefix inside a string literal of any quote, a template included. */
  const QUOTED_PREFIX = /(['"`])refs\/(?:heads|remotes\/origin)\//;
  const DOCS_CALL = /\bCCD_ARGV\.docs\w*\s*\(/;

  it('CONTROL: DEF sees each declaration shape and an un-exported copy, and not an import, a re-export, a call or a longer name', () => {
    for (const decl of [
      'export const X = 1;', 'const X = 1;', 'export interface X {', 'export type X<T> = T;', 'type X = 1;',
      'export async function X(): Promise<void> {', 'function X(): void {', 'export class X {',
    ]) expect(DEF('X').test(decl), decl).toBe(true);
    for (const miss of [
      "import { X } from './policy.js';", "import {\n  type X,\n} from './policy.js';", 'export { X };',
      'export const X_SEEN = 1;', 'const y = X(1);', 'export type XY = 1;',
    ]) expect(DEF('X').test(miss), miss).toBe(false);
  });

  it('CONTROL: exportedNames reads every exported declaration and nothing else', () => {
    expect(exportedNames(
      'export const A = 1;\nexport function b(): void {}\nexport interface C {}\nexport type D = 1;\n'
      + 'export async function e(): Promise<void> {}\nconst f = 1;\nexport { f };\n  export const g = 1;\n',
    )).toEqual(['A', 'b', 'C', 'D', 'e']);
  });

  it.each(Object.entries(HOMES))('%s is declared exactly once, in %s', (name, home) => {
    expect(holders(DEF(name))).toEqual([home]);
  });

  it('every export under server/src/docs is declared exactly once across the four roots, in its own file', () => {
    const files = sources(docsDir);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      for (const name of exportedNames(src(f))) expect(holders(DEF(name)), name).toEqual([rel(f)]);
    }
  });

  it('the table is seen by the scan: every listed name under server/src/docs is an export of its home', () => {
    for (const [name, home] of Object.entries(HOMES)) {
      if (!home.startsWith('server/src/docs/')) continue;
      expect(exportedNames(src(path.join(ccrcRoot, home))), `${name} in ${home}`).toContain(name);
    }
  });

  it('CONTROL: QUOTED_PREFIX sees a quoted prefix in each quote, and not prose or the derived name', () => {
    for (const hit of ["const l = 'refs/heads/' + b;", 'const o = `refs/remotes/origin/${b}`;', 'x === "refs/heads/main"']) {
      expect(QUOTED_PREFIX.test(stallCodeText(hit)), hit).toBe(true);
    }
    for (const miss of [' * - `refs/heads/b`: skipped, local-ref', '// refs/remotes/origin/b', 'const [l, o] = DOCS_REF_PREFIXES;']) {
      expect(QUOTED_PREFIX.test(stallCodeText(miss)), miss).toBe(false);
    }
  });

  it("the qualified ref prefixes are quoted nowhere under server/src/docs (derived from L0's prefix body)", () => {
    expect(sources(docsDir).filter((f) => QUOTED_PREFIX.test(stallCode(f))).map(rel)).toEqual([]);
  });

  it('CONTROL: DOCS_CALL sees a builder call, and not the builder table or a comment', () => {
    expect(DOCS_CALL.test(stallCodeText('await deps.runCcd(CCD_ARGV.docsFetch(project, branch));'))).toBe(true);
    expect(DOCS_CALL.test(stallCodeText("  docsFetch: (project: string, branch: string | null) =>"))).toBe(false);
    expect(DOCS_CALL.test(stallCodeText('/** the ONE `CCD_ARGV.docsFetch(` in server/src */'))).toBe(false);
  });

  it('the docs builders have one caller across the four roots: the adapter', () => {
    expect(ALL.filter((f) => DOCS_CALL.test(stallCode(f))).map(rel)).toEqual([SOURCE]);
  });
});

// Docs W3, Task 9 (spec 2026-10-01 section 2 (g)'s walls, section 2 (j) row 49, section 3.13's new scans; W3
// refinement (q)). GET never fetches, read as text: row 49's literal half (exactly one `CCD_ARGV.docsFetch(` across
// the four roots, in the adapter), WIDENED for W2's review carry, which found that `DOCS_CALL` above cannot see an
// optional-chain, a bracket or an aliased call. The identifier `docsFetch` is held to its two code lines (the builder
// key and the one call), and every other `CCD_ARGV` in code must be a plain member access, so the builder table is
// never indexed, destructured, aliased or passed. And the visible half of "L4 decides nothing": no failure word of
// `shared/docs.ts`'s `DOCS_FAILURES` is quoted in the code of `routes.ts`, `hooks.ts`, `lane.ts` or `cache.ts`. The
// words are read from that file's TEXT (and held equal to the module's keys by a dynamic import), so this append adds
// no import above. `DOCS_RING_FLOOR` (edited in place, above) names those four files too, so a deleted L4 file reds
// the floor. Every scan reads comment-stripped text (`stallCodeText`). APPENDED, for the citation audit's reason above.
describe('docs W3 — GET never fetches, and the L4 files quote no failure word (spec 2026-10-01 §2 row 49, §3.13)', () => {
  type Text = readonly [string, string];
  const SOURCE = 'server/src/docs/ccdsource.ts';
  const ARGV = 'server/src/ccdargv.ts';
  const L4_FILES = ['routes.ts', 'hooks.ts', 'lane.ts', 'cache.ts'];
  /** Every file of the four roots as `[repo-relative path, text]`, read once. */
  const LIVE: readonly Text[] = ALL.map((f) => [rel(f), readFileSync(f, 'utf8')] as const);
  /** The live corpus with `shape` planted after `name`'s own text (a copy: nothing is written). */
  const plantedIn = (name: string, shape: string): Text[] =>
    LIVE.map(([n, t]) => [n, n === name ? `${t}\n${shape}\n` : t] as const);

  const LITERAL = 'CCD_ARGV.docsFetch(';
  /** One entry per literal `CCD_ARGV.docsFetch(` in code, naming its file. */
  const literalCalls = (files: readonly Text[]): string[] =>
    files.flatMap(([n, t]) => new Array<string>(stallCodeText(t).split(LITERAL).length - 1).fill(n));
  const DOCS_FETCH_ID = /\bdocsFetch\b/;
  /** One entry per comment-stripped LINE that names the identifier `docsFetch`, naming its file. */
  const docsFetchLines = (files: readonly Text[]): string[] =>
    files.flatMap(([n, t]) => stallCodeText(t).split('\n').filter((l) => DOCS_FETCH_ID.test(l)).map(() => n));
  /** A whole static import statement, single- or multi-line (lazy, and never across a `;`). */
  const IMPORT_STATEMENT = /^\s*import\s[^;]*?\bfrom\s*(['"])[^'"\n]+\1\s*;?/gm;
  /** `CCD_ARGV` NOT followed by a plain member access (`.name`, whitespace and newlines allowed around the dot). */
  const ARGV_ESCAPE = /\bCCD_ARGV\b(?!\s*\.\s*[A-Za-z_$])/g;
  const ARGV_DECLARATION = 'export const CCD_ARGV = {';
  /** Every `CCD_ARGV` in code, imports removed, that is not a plain member access, as `file: line`; the table's one
   *  declaration excepted. */
  const argvEscapes = (files: readonly Text[]): string[] => files.flatMap(([n, t]) => {
    const code = stallCodeText(t).replace(IMPORT_STATEMENT, '');
    const out: string[] = [];
    for (const m of code.matchAll(ARGV_ESCAPE)) {
      const start = code.lastIndexOf('\n', m.index) + 1;
      const end = code.indexOf('\n', m.index);
      const at = code.slice(start, end === -1 ? code.length : end).trim();
      if (n === ARGV && at === ARGV_DECLARATION) continue;
      out.push(`${n}: ${at}`);
    }
    return out;
  });

  it('row 49, literal: exactly one `CCD_ARGV.docsFetch(` across the four roots, in the adapter', () => {
    expect(literalCalls(LIVE)).toEqual([SOURCE]);
  });

  it('row 49, widened by identifier: `docsFetch` names two code lines, the builder key and the one call', () => {
    expect(docsFetchLines(LIVE).sort()).toEqual([ARGV, SOURCE]);
  });

  it('row 49, widened by use: `CCD_ARGV` is only ever a plain member access, outside its one declaration', () => {
    expect(argvEscapes(LIVE)).toEqual([]);
    expect(LIVE.filter(([n]) => n === ARGV).flatMap(([, t]) => stallCodeText(t).split('\n'))
      .filter((l) => l.trim() === ARGV_DECLARATION), 'the declaration the escape scan excepts moved').toHaveLength(1);
  });

  it('CONTROL: every call shape the literal scan misses is caught by one of the two widened scans; prose by neither', () => {
    const base = {
      literal: literalCalls(LIVE).length, lines: docsFetchLines(LIVE).length, escapes: argvEscapes(LIVE).length,
    };
    const SHAPES: readonly (readonly [string, boolean, boolean])[] = [
      // [the planted text, seen by the identifier scan, seen by the escape scan]
      ['const a = CCD_ARGV?.docsFetch(p, b);', true, true],
      ["const a = CCD_ARGV['docsFetch'](p, b);", true, true],
      ['const a = CCD_ARGV["docsFetch"](p, b);', true, true],
      ['const { docsFetch } = CCD_ARGV;', true, true],
      ['const A = CCD_ARGV; A.docsFetch(p, b);', true, true],
      ['const a = CCD_ARGV\n  .docsFetch(p, b);', true, false],
      ["const f = Reflect.get(CCD_ARGV, 'docsFetch');", true, true],
    ];
    for (const [shape, byId, byEscape] of SHAPES) {
      const planted = plantedIn(SOURCE, shape);
      expect(literalCalls(planted).length, `${shape}: the literal scan was expected to miss it`).toBe(base.literal);
      expect(docsFetchLines(planted).length > base.lines, `${shape}: identifier scan`).toBe(byId);
      expect(argvEscapes(planted).length > base.escapes, `${shape}: escape scan`).toBe(byEscape);
      expect(byId || byEscape, shape).toBe(true);
    }
    for (const prose of ['// a CCD_ARGV?.docsFetch( or `const { docsFetch } = CCD_ARGV` in prose',
      ' * CCD_ARGV[\'docsFetch\'] named in a docstring']) {
      const planted = plantedIn(SOURCE, prose);
      expect(docsFetchLines(planted).length, prose).toBe(base.lines);
      expect(argvEscapes(planted).length, prose).toBe(base.escapes);
    }
    expect(literalCalls(plantedIn(SOURCE, 'void CCD_ARGV.docsFetch(p, b);')).length, 'the literal scan is blind')
      .toBe(base.literal + 1);
  });

  /** `DOCS_FAILURES`' keys, read from `shared/docs.ts`'s TEXT: its `export const DOCS_FAILURES = {` block. */
  const failureWords = (): string[] => {
    const text = readFileSync(path.join(ccrcRoot, 'shared/docs.ts'), 'utf8');
    const open = text.indexOf('export const DOCS_FAILURES = {');
    const close = text.indexOf('} as const', open);
    expect(open, 'the DOCS_FAILURES block moved').toBeGreaterThan(-1);
    expect(close, 'the DOCS_FAILURES block has no end').toBeGreaterThan(open);
    return [...text.slice(open, close).matchAll(/^\s*'([a-z][a-z-]*)':/gm)].map((m) => m[1]);
  };
  /** The words of `words` quoted as a whole literal (single, double or backtick) in `text`'s code. */
  const quotedWords = (text: string, words: readonly string[]): string[] => {
    const code = stallCodeText(text);
    return words.filter((w) => new RegExp(`(['"\`])${w}\\1`).test(code));
  };
  const l4 = (): Text[] =>
    L4_FILES.map((n) => [n, readFileSync(path.join(ccrcRoot, 'server/src/docs', n), 'utf8')] as const);

  it('the failure words read from the text are exactly DOCS_FAILURES\' keys', async () => {
    const { DOCS_FAILURES } = await import('../../shared/docs.js');
    expect(failureWords()).toEqual(Object.keys(DOCS_FAILURES));
  });

  it('CONTROL: a quoted word is seen in each quote; a backticked word in a prose comment is not', () => {
    const words = failureWords();
    for (const hit of ["const w = 'docs-busy';", 'const w = "bad-query";', 'const w = `foreign-request`;']) {
      expect(quotedWords(hit, words), hit).toHaveLength(1);
    }
    for (const miss of ['// the lane answers `docs-busy` past its wait', ' * a `bad-query {why}` refusal',
      'const w = docsBusyBody(lane);']) {
      expect(quotedWords(miss, words), miss).toEqual([]);
    }
  });

  it('L4 decides nothing (the visible half): routes.ts, hooks.ts, lane.ts and cache.ts quote no failure word', () => {
    const words = failureWords();
    const files = l4();
    expect(files.map(([n]) => n)).toEqual(L4_FILES);
    expect(files.flatMap(([n, t]) => quotedWords(t, words).map((w) => `${n}: '${w}'`))).toEqual([]);
  });
});

// APPENDED AT THE END OF THE FILE, DELIBERATELY. `session-hook.test.ts` pins a
// measured census of how many line citations in two frozen corpus documents
// fail to anchor, grouped by the file they cite — and this file is one of
// them. Inserting a describe block in the MIDDLE shifts every line below it
// and moved that census from 8 to 15 (measured, on CI and locally). The
// citations are frozen by design and Task 11 owns repairing them; a new guard
// is not a reason to re-measure someone else's debt, so it goes where it
// shifts nothing.

describe("one 'tmux unreachable' sentence (design-system wave)", () => {
  // SEVEN COPIES, and three of them carried a comment saying the string was
  // "SessionLine's chip's own `tmux unreachable — <reason>`, never a second
  // copy". Every one of those was the second copy. The sentence is operator
  // COPY, so it lives in the PWA (`pwa/src/fleet/substrateWords.ts`) rather
  // than beside `substrateFault` in L0, and this is what keeps it there.
  //
  // Invisible to every census on this branch by construction: it is not a
  // stylesheet rule, not an element, not a two-word class literal and not a
  // leaf's attribute set — one template literal, in seven files.
  const SENTENCE = /`tmux unreachable — \$\{/;

  it('is composed in exactly one file, and that file is substrateWords.ts', () => {
    const holders = ALL.filter((f) => SENTENCE.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['pwa/src/fleet/substrateWords.ts']);
  });

  it('and every surface that showed it still reaches it', () => {
    // The other direction: a fold that deleted the callers instead of pointing
    // them at the word would satisfy the test above and lose the tooltip.
    for (const f of [
      'pwa/src/fleet/SessionActionsSheet.tsx', 'pwa/src/fleet/ArchiveSheet.tsx',
      'pwa/src/fleet/SessionMeta.tsx', 'pwa/src/screens/SessionScreen.tsx',
      'pwa/src/session/SessionHeader.tsx', 'pwa/src/session/PrSheet.tsx',
    ]) {
      expect(readFileSync(path.join(ccrcRoot, f), 'utf8'), f)
        .toMatch(/substrateFaultT(ext|itle)\(/);
    }
  });
});
