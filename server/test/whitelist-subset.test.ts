// Three layers against one failure: an argv the server emits that the agent
// refuses. That failure is invisible to every other test in this repo — the
// route returns 502 only on the live fleet — and it has already shipped once
// (ws-add/ws-rm).
import { describe, it, expect } from 'vitest';
import {
  EXEC_WHITELIST, FORBIDDEN_COMMANDS, UNGRANTABLE_VERBS, isExecAllowed,
} from '../../agent/src/whitelist.js';
import { CCD_ARGV, verbSupported } from '../src/ccdargv.js';

/** One representative call per entry. Every entry MUST appear: the exhaustive
 *  assertion below is what stops a new route hiding behind an untested one. */
const SAMPLES: Record<keyof typeof CCD_ARGV, string[]> = {
  start: ['claude', 'demo'],
  // `enable` is a SEPARATE entry, not a parameter of `start`: POST /api/sessions
  // picks between the two words (`POST /api/sessions` in `server.ts`) and the agent grants them
  // separately, so layer 3 below fails outright if nothing builds `enable`.
  enable: ['claude', 'demo'],
  ensure: ['demo-quiet-basin'],
  stopId: ['demo-quiet-basin'],
  stopPair: ['claude', 'demo'],
  forget: ['claude-corp-demo'],
  swap: ['demo-quiet-basin', 'claude2'],
  wsAdd: ['demo'],
  prStateSession: ['demo-quiet-basin'],
  prStateProject: ['demo'],
  prOpen: ['demo-quiet-basin', 'the work', 'Ym9keQ==', 'false'],
  wsArchive: ['demo-quiet-basin'],
  wsRestore: ['demo-quiet-basin'],
  wsAudit: ['demo-quiet-basin'],
  wsReap: ['a'.repeat(64), 'demo-quiet-basin'],
  wsAttic: ['demo-quiet-basin'],
  wsHold: ['demo-quiet-basin', 'program:agent-evals wave:1/4'],
  wsRelease: ['demo-quiet-basin'],
  wsRename: ['demo-quiet-basin', 'ws/brainstorm-helix-and-slide-notes'],
};

/**
 * NO EXEMPTION SET (review finding 1, and the reason this note replaces one).
 *
 * The first draft of the hold branch shipped `wsHold`/`wsRelease` as `CCD_ARGV`
 * entries with no matching grant in `EXEC_WHITELIST.ccd`, and amended the two
 * assertions below to EXPECT that — a documented `NOT_YET_GRANTED` set, so the
 * file went green on exactly the state it exists to catch. What it was
 * describing is the failure in this file's header, wearing the branch's own
 * wording: in remote mode both routes answer `502 {stderr:'forbidden'}` for
 * every session, forever, while `/archive` and `/restore` on the same actions
 * sheet keep working. The grants landed instead; the assertion below is
 * exhaustive again, `=== true` for every entry with no list to consult.
 */

describe('layer 2 — every argv the server can build passes the agent whitelist', () => {
  it('has a sample for every CCD_ARGV entry', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(CCD_ARGV).sort());
  });

  it.each(Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[])('%s', (key) => {
    // `readonly string[]`, not `string[]`: entries return the branded `CcdArgv`
    // (task 13S), which is readonly, so the old cast target is no longer a
    // comparable type. `isExecAllowed` takes a mutable array, hence the copy.
    const build = CCD_ARGV[key] as (...a: unknown[]) => readonly string[];
    const argv = build(...(SAMPLES[key] as unknown[]));
    expect(isExecAllowed('ccd', [...argv]), `${key} -> ccd ${argv.join(' ')}`).toBe(true);
  });
});

// Layer 2b — DELETED in task 13S, and deliberately not replaced with a fifth
// regex. It asserted "every ccd argv is built in ccdargv.ts and nowhere else"
// by scanning the source TEXT of `src/`, and was defeated in four consecutive
// rounds by four different ways of naming a value: an inline array literal at
// the call site; a `const argv = [...]` extracted before the call; a
// `const runner = deps.run` aliasing the runner; and a one-identifier rename
// (`args`) that walked straight through the untraced parameter-name exemption.
// A text scan over a Turing-complete language cannot enumerate the ways to
// name a value.
//
// The property is now unexpressible-to-violate rather than policed:
//   * `CCD_ARGV`'s entries return `CcdArgv`, a nominally branded
//     `readonly string[]`, and the single cast that mints one lives in
//     `ccdargv.ts` — so no `string[]`, however built or named, is assignable;
//   * `Deps` carries no raw `run`, only `runCcd: (argv: CcdArgv) => …`, so
//     there is no runner to reach and no value of the right type to invent.
// `ccdargv-brand.test.ts` pins both halves as COMPILE failures, replaying all
// four historical bypasses. What that mechanism does NOT cover, disclosed
// rather than implied, is written up there.

describe('layer 3 — the list never drifts wider than the code', () => {
  // FINAL REVIEW, gates finding 4. Everything else in layer 3 works off a SLICE
  // of `whitelist.ts`'s source text that starts at the `ccd` key — so whether it
  // sees a new grant depends on where in the object literal the key is written.
  // Measured on `4e8b689`: a `gh` key added ABOVE the `ccd` one left this file
  // at 35/35 PASS, because it sits outside the slice. This assertion reads the
  // OBJECT, not the text, so position cannot matter; and it lives in a different
  // package from the agent's own pins, so deleting agent tests cannot reach it.
  it('EXEC_WHITELIST has exactly two keys, and `gh` is not one of them', () => {
    expect(Object.keys(EXEC_WHITELIST).sort(),
      'a gh grant makes EXEC_WHITELIST the sole control between the PWA and `gh pr merge`: ' +
      'the host token carries the repo WRITE scope and there is no second credential')
      .toEqual(['ccd', 'tmux']);
  });

  it('no forbidden command is grantable, and none is allowed with any argv', () => {
    for (const cmd of FORBIDDEN_COMMANDS) {
      expect(Object.keys(EXEC_WHITELIST), cmd).not.toContain(cmd);
      expect(isExecAllowed(cmd, ['pr', 'merge', '1']), cmd).toBe(false);
    }
    expect((FORBIDDEN_COMMANDS as readonly string[])).toContain('gh');
  });

  it('every ccd prefix the agent grants is reachable from some CCD_ARGV entry', () => {
    // The reverse direction. This is what catches a dead grant like `clip`.
    //
    // READS THE OBJECT, not the source text (verify round 2, P1). This was the
    // last source-text parse left in the file, and it carried every hazard the
    // sibling assertion above was rewritten to escape: it sliced from
    // `wl.indexOf('ccd: [')`, so it was position-dependent, it had to strip
    // line comments so that `['ws-gc'] would permit --prune` in a comment was
    // not read as a grant, and it silently `filter`ed OUT empty prefixes —
    // the single widest grant expressible (`[].every(...)` is vacuously true,
    // so one empty prefix permits every ccd verb). The exported object is
    // already imported at the top of this file; parsing its own source instead
    // was work in the wrong direction. Same values, no parse.
    const granted: readonly (readonly string[])[] = EXEC_WHITELIST.ccd;
    const built = (Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[])
      .map((k) => (CCD_ARGV[k] as (...a: unknown[]) => readonly string[])(...(SAMPLES[k] as unknown[])));
    for (const prefix of granted) {
      expect(prefix.length, 'an empty prefix grants every ccd verb that exists').toBeGreaterThan(0);
      const reachable = built.some((argv) => prefix.every((tok, i) => argv[i] === tok));
      expect(reachable, `ccd ${prefix.join(' ')} is granted but no route builds it`).toBe(true);
    }
  });

  // VERIFY ROUND 2, P1 — the CROSS-PACKAGE half of the `--expect` pin.
  //
  // The gh fix gave the key set four mechanisms in three classes and left the
  // prefix VALUES with none. The verifier measured the consequence: changing
  // `['ws-reap', '--expect']` to `['ws-reap']` left `tsc -p agent` clean, left
  // the agent's module-load audit silent, and left THIS FILE at 37/37 — layer
  // 2's reachability check passes on the mutant, because `['ws-reap']` is a
  // genuine prefix of the argv `CCD_ARGV.wsReap` builds. Two deletable agent
  // test files were the whole pin on a token-free reap.
  //
  // This assertion is the one that lives in a DIFFERENT PACKAGE, so deleting
  // agent tests cannot reach it, and it reads the object rather than its text,
  // so where the grant is written cannot matter.
  it('ws-reap is grantable ONLY with its confirmation token, and no reap is grantable without one', () => {
    const reap = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-reap');
    expect(reap.length, 'exactly one ws-reap grant').toBe(1);
    expect(reap[0],
      'a bare `ws-reap` grant is not a narrower grant — it permits an UNCONFIRMED reap, ' +
      'which is the one thing §7 says can never cross the wire')
      .toEqual(['ws-reap', '--expect']);

    // Behaviour, not just shape: the argv a caller would have to build to reap
    // without a token must be refused by the agent's own lookup.
    const tok = 'a'.repeat(64);
    expect(isExecAllowed('ccd', ['ws-reap', '--session', 'demo-quiet-basin'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap', tok, '--session', 'demo-quiet-basin'])).toBe(false);
    // …and the one the server actually builds is still allowed, so this is not
    // a blanket refusal of the verb.
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsReap(tok, 'demo-quiet-basin')])).toBe(true);
  });

  // The SECOND entry in REQUIRED_VERB_FLAG, and the first one that is not there
  // because the verb is destructive. `ws-rename` destroys nothing; it is here
  // because it is the SECOND WRITE the server calls unattended — after
  // `ws-archive`, which `FleetWatcher.archiveMerged` already fires on merge
  // with no human in the loop — and the first whose argv is derived from
  // model output (FleetWatcher's naming sweep). So the grant must name the
  // flag rather than the verb: a bare `['ws-rename']` permits `ccd ws-rename
  // <anything> <anything…>`, which is exactly the positional argv surface
  // this branch left behind. Cross-PACKAGE and object-reading, for the
  // reasons the ws-reap assertion above states.
  it('ws-rename is grantable ONLY with --session', () => {
    const rn = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-rename');
    expect(rn.length, 'exactly one ws-rename grant').toBe(1);
    expect(rn[0]).toEqual(['ws-rename', '--session']);
    expect(isExecAllowed('ccd', ['ws-rename', 'demo-quiet-basin', 'ws/x'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-rename'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x')])).toBe(true);
  });

  it('no ungrantable ccd verb is granted, with any flags at all', () => {
    // ws-rm is the unguarded legacy delete; ws-gc carries --prune. Both were
    // previously kept out only by the reachability check above (no route builds
    // them) — i.e. by an accident of the server's route list rather than by a
    // rule. `UNGRANTABLE_VERBS` states the rule, and this asserts it from the
    // other side of the package boundary.
    const heads = EXEC_WHITELIST.ccd.map((p) => p[0]);
    for (const verb of UNGRANTABLE_VERBS) {
      expect(heads, `${verb} must never head a granted prefix`).not.toContain(verb);
      expect(isExecAllowed('ccd', [verb, '--session', 'x']), verb).toBe(false);
      expect(isExecAllowed('ccd', [verb, '--prune']), verb).toBe(false);
    }
  });

  it('refuses to emit a verb the agent did not advertise, and permits everything when it said nothing', () => {
    const state = { connected: true, downSince: null, ccdVerbs: ['start', 'pr-state'] };
    expect(verbSupported(state, CCD_ARGV.prStateSession('x'))).toBe(true);
    expect(verbSupported(state, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(false);
    // Null is "no evidence", not "no verbs": local mode and an older agent
    // must not have every control greyed out.
    // A NAMED const, not an inline literal, same as `state` above: an inline
    // object literal passed directly as an argument is excess-property-
    // checked against the narrower `Pick<FleetState, 'ccdVerbs'>` parameter
    // type, and `connected`/`downSince` aren't in it — a pre-existing type
    // error invisible to every gate because server's tsconfig excludes
    // test/. Same runtime value either way; only the shape TS checks it
    // against changes.
    const nullState = { connected: true, downSince: null, ccdVerbs: null };
    expect(verbSupported(nullState, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(true);
    expect(verbSupported(undefined, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(true);
  });

  // Review finding (round 1, Task 11): mutating `if (verbs === null)` to
  // `if (verbs === null || verbs.length === 0)` left the whole suite green —
  // nothing above exercises `ccdVerbs: []` against `verbSupported`, only
  // `null` and a populated array. The distinction is load-bearing: `null`
  // means "no evidence yet" (a reconnect is in flight — permit, per the test
  // above); `[]` means the fleet ACTIVELY reported zero verbs (a real answer,
  // however sparse) — refuse. Conflating them would silently re-permit
  // everything for the duration of a state that ought to grey the whole
  // feature out.
  it('an EMPTY ccdVerbs is not the same as null — the fleet reported no verbs, so refuse', () => {
    const empty = { connected: true, downSince: null, ccdVerbs: [] };
    expect(verbSupported(empty, CCD_ARGV.wsReap('a'.repeat(64), 'x'))).toBe(false);
    expect(verbSupported(empty, CCD_ARGV.ensure('x'))).toBe(false);
  });
});

describe('layer 2c — exact argv, not just prefix compliance (mutation-sweep finding)', () => {
  // MUTATION-SWEEP FINDING (Task 11, M10): swapping `--title`/t and
  // `--body-b64`/b64 in `CCD_ARGV.prOpen` left the whole suite green. Layer 2's
  // `isExecAllowed` and layer 3's reachability check both stop at the GRANTED
  // PREFIX (`['pr-open', '--session']` — two tokens for `prOpen`; similarly
  // short prefixes for every `--session`/`--project`-flavoured entry), so
  // nothing before this test ever looked past it. `ccd` itself enforces fixed
  // arity and flag order on every one of these seven new verbs (Task 9
  // review), so a reordered argv is green in this repo and FORBIDDEN — or
  // silently wrong — on the fleet: "route added, whitelist not updated, all
  // suites green, dead on the fleet" wearing a different hat.
  //
  // Audited (corrected — an earlier draft of this comment wrongly lumped
  // `wsReap` in with the single-trailing-id group below; the fix already
  // covered it correctly, only the prose was wrong): of the other entries
  // with a flag beyond the granted prefix, `prStateSession`, `prStateProject`,
  // `wsArchive`, `wsRestore`, `wsAudit`, and `wsAttic` have exactly one flag
  // immediately inside the prefix plus a single trailing id, which has
  // nothing to reorder against. `wsReap` does NOT belong in that group: its
  // prefix (`['ws-reap', '--expect']`) is followed by `tok`, and THEN a
  // second flag+value pair (`--session`, id) — the same shape as `prOpen`
  // (a bare value immediately after the prefix, then more flag pairs), just
  // with one pair instead of three. So `prOpen` and `wsReap` both have order
  // that can silently drift; this table pins all fifteen regardless — token
  // for token, not just "the agent would let it through" — one assertion
  // closes the class rather
  // than one instance of it.
  const EXPECTED: Record<keyof typeof CCD_ARGV, string[]> = {
    start: ['start', 'claude', 'demo'],
    enable: ['enable', 'claude', 'demo'],
    ensure: ['ensure', 'demo-quiet-basin'],
    stopId: ['stop', 'demo-quiet-basin'],
    stopPair: ['stop', 'claude', 'demo'],
    forget: ['forget', 'claude-corp-demo'],
    swap: ['swap', 'demo-quiet-basin', 'claude2'],
    wsAdd: ['ws-add', 'demo'],
    prStateSession: ['pr-state', '--session', 'demo-quiet-basin'],
    prStateProject: ['pr-state', '--project', 'demo'],
    // SAMPLES.prOpen's fourth element is the STRING 'false' (SAMPLES is typed
    // string[] and the call site casts through `unknown[]`), which is truthy
    // at runtime — so this sample actually exercises the `draft: true` arm.
    // The real boolean-vs-boolean mapping is pinned unambiguously below.
    prOpen: ['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'true'],
    wsArchive: ['ws-archive', '--session', 'demo-quiet-basin'],
    wsRestore: ['ws-restore', '--session', 'demo-quiet-basin'],
    wsAudit: ['ws-audit', '--session', 'demo-quiet-basin'],
    wsReap: ['ws-reap', '--expect', 'a'.repeat(64), '--session', 'demo-quiet-basin'],
    wsAttic: ['ws-attic', '--session', 'demo-quiet-basin'],
    wsHold: ['ws-hold', '--session', 'demo-quiet-basin', '--reason', 'program:agent-evals wave:1/4'],
    wsRelease: ['ws-release', '--session', 'demo-quiet-basin'],
    wsRename: ['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/brainstorm-helix-and-slide-notes'],
  };

  it.each(Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[])('%s builds the exact argv, token for token', (key) => {
    const build = CCD_ARGV[key] as (...a: unknown[]) => readonly string[];
    expect(build(...(SAMPLES[key] as unknown[]))).toEqual(EXPECTED[key]);
  });

  it('prOpen maps a real boolean draft to --draft true/false unambiguously', () => {
    expect(CCD_ARGV.prOpen('demo-quiet-basin', 'the work', 'Ym9keQ==', true))
      .toEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'true']);
    expect(CCD_ARGV.prOpen('demo-quiet-basin', 'the work', 'Ym9keQ==', false))
      .toEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work', '--body-b64', 'Ym9keQ==', '--draft', 'false']);
  });
});
