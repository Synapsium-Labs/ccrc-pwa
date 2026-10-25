// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AUTH_VERDICTS, PR_REASONS, isPrReason } from '../../../shared/api.js';
import { ALL, REACH, ROOTS, ccrcRoot, here, holdersOf, passage, prose, rel, sources } from './helpers.js';


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
    // Thirteen. The tenth was `branch-drift`, added when the PR poller stopped
    // asserting a phase for a workspace whose registry and worktree record name
    // different branches (D-178); the eleventh and twelfth are `unavailable`
    // and `truncated`, split off `error` on 2026-08-26 once a 5xx from
    // api.github.com and a body that stopped mid-stream were measured as two
    // distinct, repeatable faults that `error` was describing with one sentence
    // about a third thing; the thirteenth is `cut-short`, split off
    // `agent-down` in landing-order wave 3c once a read ended by a deadline was
    // measured as a slow lane, not a dead one. Each is recognised by the
    // predicate both validators use. A hand-written list would still pass (the
    // source scan below exists for that); a DERIVED list out of step with the
    // union cannot be built. The count is the ONE thing a new member touches,
    // deliberately: it is what makes adding one a decision.
    expect(PR_REASONS).toHaveLength(13);
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
    // Six negative-form guards at 5e9f650d (2026-09-02), one per writer. Since
    // D-5997 (#532) the guard is spelled in ONE place, `writeDeliveries`: the
    // plain negative form and `markAcked`'s replay-ceiling exception. An EXACT
    // count now, because a third spelling is a writer that bypassed the one
    // writer — exactly what this pin exists to catch.
    expect((code.match(/NOT IN \$\{TERMINAL_DELIVERY_SQL\}/g) ?? []).length).toBe(2);
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
  describe('the coord ring — only store.ts, rundefsTx.ts and routes.ts hold the handle', () => {
    const coordDir = path.join(ccrcRoot, 'server/src/coord');
    // D-5896: `rundefs.ts` left this set when its mail writes moved to `rundefsTx.ts`; `tx.ts` is `tx` itself.
    const HANDLE_HOLDERS = new Set(['store.ts', 'rundefsTx.ts', 'routes.ts', 'db.ts', 'schema.ts', 'tx.ts']);
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
