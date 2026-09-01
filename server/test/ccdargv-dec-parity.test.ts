// server/test/ccdargv-dec-parity.test.ts
//
// THE CROSSING NOTHING ELSE MAKES: every `CCD_ARGV` builder that APPENDS a dec
// against every ccd verb that PARSES one, measured by running the real `ccd`.
//
// Everything else in this repo checks one side alone. `whitelist-subset.test.ts`
// crosses the builders against the AGENT's prefix whitelist — and the agent
// grants a bare `['ws-add']` with the trailing tokens unconstrained
// (`agent/src/whitelist.ts`), so a dec it can never parse crosses that gate
// green. `run-routes.test.ts` compares the composed tokens against a fixture
// RUNNER double, which accepts any array at all. `unattended-actor.test.ts`
// scans for builders that *should* declare. Not one of them executes ccd, so
// between them they cannot see the only question that matters at the seam:
// does the binary on the fleet host understand what we just composed?
//
// It has already cost once, and that is D-410. `wsAddWorker` was given
// `...decFlags(dec)` on the argument that `actor-flags-v1` means "this box takes
// the flags" — and that token means something narrower, in ccd's own words
// (`ccd/ccd`, `cmd_caps`): it "decides ONE server-side thing: whether to APPEND
// `--surface`/`--actor`/`--reason` to the FIVE WORKSPACE VERBS". `ws-add` was
// not one of the five. `cmd_ws_add` consumed an exact-string `--no-rc` and then
// bound `slug="${2:-}"` with no flag parser at all, so the dec's first token
// landed in the SLUG and the verb died at `_ws_slug_valid` — before a worktree,
// a registry row or a pane existed. Every wave-1 dispatch on a caps-advertising
// box would have refused, the registry diff would have found zero candidates,
// and the run would have sat at `planned` with `dispatchStartedAt` set: the
// exact wedge Build 9b exists to render, manufactured by the commit that renders
// it. 223 green server files saw none of it.
//
// THE PAST TENSE IS EARNED. D-410's named remedy shipped in this same programme:
// `cmd_ws_add` now carries `cmd_ws_hold`'s strip-then-bind loop and threads what
// it parsed into its own `create` row, so the builder declares again — and this
// file's `ws-add` case turned from a negative control into a sixth probe. The
// capability token did NOT change with it (the ruling: no new ccd verb, no new
// grant), so what keeps an old box safe is DEPLOY ORDER — ccd ships to the fleet
// host first, and a new ccd under an old server simply never receives the flags.
// That residual is disclosed on `wsAddWorker`'s own docstring, where a reader
// composing the argv will meet it.
//
// So the mechanism is a DERIVATION on the server side and an EXECUTION on the
// ccd side. Nothing here is a hand-kept list of "builders that declare": the set
// is read out of `ccdargv.ts` itself, so a builder that gains a dec joins this
// suite the moment it does, and a verb whose real parser refuses the flags reds
// on its own refusal rather than on someone remembering to add a case.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan; every bash spawn here goes through `ghContainedEnv` and asks
// for both poisons.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, ghContainedEnv, harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_ARGV, type ActorFlags } from '../src/ccdargv.js';
import { decOf, eventsOf, measOf } from './lifecycleHelpers.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** Exactly what `sweepDec` composes for an unattended lane — `reason: null`, so
 *  `decFlags` contributes `--surface`/`--actor` and nothing else. This is the
 *  shape every server-side dispatch, sweep and close actually sends, and the
 *  shape that killed `ws-add`. The `--reason` half of `decFlags` is a separate
 *  question, parsed per verb (`ws-hold` refuses a second reason on purpose) and
 *  already pinned by ccd's own suites. */
const PROBE_DEC: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: null };

/**
 * THE DERIVED SET: which ccd verbs does `CCD_ARGV` append a dec to?
 *
 * Read out of the source rather than typed, for exactly the reason
 * `unattended-actor.test.ts`'s hand-kept `BUILDERS` regex failed — a name-list
 * makes a new builder invisible BY CONSTRUCTION, so the thing it misses is
 * always the thing nobody thought of. Here the scan walks every `argv([…])`
 * literal in the table: the first quoted token is the verb, and the presence of
 * `decFlags(` anywhere inside that literal is the declaration.
 */
function decAppendingVerbs(): string[] {
  const src = fs.readFileSync(path.join(srcRoot, 'ccdargv.ts'), 'utf8');
  const table = src.slice(src.indexOf('export const CCD_ARGV'));
  const found = new Set<string>();
  for (const m of table.matchAll(/argv\(\[([\s\S]*?)\]\)/g)) {
    const body = m[1]!;
    const verb = /^\s*'([a-z][a-z-]*)'/.exec(body)?.[1];
    if (verb !== undefined && body.includes('decFlags(')) found.add(verb);
  }
  return [...found].sort();
}

/**
 * How to invoke each verb through its OWN builder, minimally, so that the only
 * variable between the control and the probe is the dec.
 *
 * The argv is COMPOSED, never typed: this suite exists to measure what the
 * server actually sends, and a hand-written token list would measure what
 * someone believed it sends.
 *
 * FIVE OF THE SIX name a session that does not exist, so real ccd refuses for a
 * reason of its own and touches nothing — which is the point: a verb that
 * PARSES the dec strips it before it binds positionals, and so gives
 * byte-identical refusals with and without it. A verb that does not parse it
 * gives a DIFFERENT refusal, naming the flag.
 *
 * `ws-add` IS THE SIXTH AND IT CANNOT BE PROBED THAT WAY. Measured, not
 * assumed: point it at an ABSENT PROJECT and both arms die
 * `ccd: not a git repo: <home>/projects/__no-such-session__` at rc 1,
 * byte-identical — with the flag loop AND without it, because `cmd_ws_add`
 * validates the project (`ccd:2611-2614`) a dozen lines before anything looks
 * at the slug. An absent-project probe here would have gone green on the very
 * tree D-410 was found in, which makes it worse than no probe: it would read
 * like a measurement. So `ws-add`'s probe names a REAL project, `setup` builds
 * it, and the third assertion — "the control really got somewhere" — becomes
 * per-verb rather than one sentence about absent sessions.
 */
interface Probe {
  /** The argv, through the verb's own builder. */
  argv: (dec: ActorFlags | null) => readonly string[];
  /** Whatever the fixture must hold before the two arms are comparable. */
  setup?: () => void;
  /** Proof the CONTROL arm reached the place an unparsed flag WOULD have been
   *  seen. Two identical no-ops — or two identical successes — satisfy the
   *  equality above while measuring nothing, so every verb has to say what
   *  "it really got there" looks like for it. */
  reached: (control: { code: number; out: string }) => void;
}

const ABSENT = '__no-such-session__';
const PROJECT = 'demo';

/** The five session verbs' witness, said once: the refusal names the session
 *  the fixture deliberately does not have. That is also what proves the flags
 *  were stripped BEFORE positional binding rather than merely tolerated — a
 *  verb that bound `--surface` as its session would refuse naming the flag. */
const refusedForTheAbsentSession = (c: { out: string }): void => {
  expect(c.out, 'the control probe did not refuse for the absent session').toContain(ABSENT);
};

/** The registry rows that EXIST, by the `.uuid` field every other reader in
 *  this repo treats as row-exists (the `.ws-add-<project>.lock` a flock leaves
 *  behind is not a session and is not counted as one). */
const uuidRows = (): string[] =>
  fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((f) => f.endsWith('.uuid')).sort();

const PROBES: Record<string, Probe> = {
  'ws-archive': { argv: (d) => CCD_ARGV.wsArchive(ABSENT, d), reached: refusedForTheAbsentSession },
  'ws-restore': { argv: (d) => CCD_ARGV.wsRestore(ABSENT, d), reached: refusedForTheAbsentSession },
  'ws-hold': { argv: (d) => CCD_ARGV.wsHold(ABSENT, 'probe reason', d), reached: refusedForTheAbsentSession },
  'ws-release': { argv: (d) => CCD_ARGV.wsRelease(ABSENT, d), reached: refusedForTheAbsentSession },
  'ws-rename': { argv: (d) => CCD_ARGV.wsRename(ABSENT, 'ws/probe', d), reached: refusedForTheAbsentSession },
  'ws-add': {
    argv: (d) => CCD_ARGV.wsAddWorker(PROJECT, d),
    setup: () => { h.makeRepo(PROJECT); },
    // `ws-add`'s exposure IS its positionals, so "it really got there" means
    // the control got PAST the slug binding: exactly one registry row, named
    // `<project>-<slug>` with a slug `_ws_slug_valid` would accept. The exit
    // status is NOT the witness — this fixture cannot finish a spawn, so both
    // arms answer rc 3 with no output at all, which is byte-identical and says
    // nothing about how far either got.
    reached: () => {
      const rows = uuidRows();
      expect(rows, 'the control ws-add created no workspace — it refused before the slug bound')
        .toHaveLength(1);
      expect(rows[0]!, 'the control ws-add named its workspace after something _ws_slug_valid refuses')
        .toMatch(/^demo-[a-z0-9][a-z0-9-]{1,30}\.uuid$/);
    },
  },
};

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-dec-parity-'); });
afterEach(() => { h.cleanup(); });

/** The real binary, in the fixture HOME, through the dispatcher — not a sourced
 *  function — because the dispatcher's own `shift` is part of the parse contract
 *  this suite is about.
 *
 *  BOTH STREAMS, and the exit code, folded into one answer: ccd's verbs refuse
 *  in two different dialects. `cmd_ws_hold`/`cmd_ws_archive` `die` (stderr, exit
 *  1); `cmd_ws_rename`/`cmd_ws_restore` answer the machine-readable
 *  `{"refused":…}` document on stdout at exit 0, because the server learns those
 *  verdicts from a refusal TOKEN rather than a status. A comparison that read
 *  only one stream would be blind on half the table. */
const runCcd = (args: readonly string[]): { code: number; out: string } => {
  const stub = harnessBin(h.home);
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home,
      { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` },
      { systemd: true, tmux: true }),
  };
  try {
    const stdout = execFileSync('bash', [CCD, ...args], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: String(stdout).trim() };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`.trim() };
  }
};

describe('every dec-appending CCD_ARGV builder names a verb real ccd parses a dec on', () => {
  it('derives the dec-appending verbs from the table, and finds six — the five workspace verbs and ws-add', () => {
    // BOTH DIRECTIONS, and the second one is the one this suite was written
    // for. A verb ADDED here without a ccd that parses it is caught by the
    // execution test below; a verb SILENTLY added is caught right here, because
    // the derivation cannot miss it and this equality cannot absorb it.
    //
    // SIX, NOT FIVE, SINCE D-410's REMEDY. `actor-flags-v1` still gates exactly
    // the five WORKSPACE verbs `cmd_caps` names — that sentence did not widen,
    // and no new token was minted — but `cmd_ws_add` grew the parse of its own
    // in the same programme, so the SERVER may now declare on a sixth verb. The
    // safety of reusing one token across the two is not asserted here and is
    // not a property of source text: it is the AGENT-FIRST deploy order, stated
    // where the argv is composed.
    expect(decAppendingVerbs())
      .toEqual(['ws-add', 'ws-archive', 'ws-hold', 'ws-release', 'ws-rename', 'ws-restore']);
  });

  it('has a probe for every derived verb — a new one cannot join unmeasured', () => {
    // The anti-whitelist clause. If `PROBES` were merely consulted, a builder
    // that gained a dec with no probe entry would be skipped in silence, which
    // is the same defect shape as the `BUILDERS` name-list this file replaces.
    expect(decAppendingVerbs().filter((v) => !(v in PROBES))).toEqual([]);
  });

  for (const verb of decAppendingVerbs()) {
    it(`${verb}: real ccd answers identically with and without the dec — the flags are parsed, not bound`, () => {
      const probe = PROBES[verb]!;
      probe.setup?.();
      const control = runCcd(probe.argv(null));
      // The witness runs BEFORE the second arm, deliberately: `ws-add`'s reads
      // the registry, and the declared arm writes a second row into it.
      probe.reached(control);
      const declared = runCcd(probe.argv(PROBE_DEC));
      // Byte-identical: same exit code, same words. A verb whose parser strips
      // `--surface`/`--actor` before positional binding cannot tell these two
      // calls apart by the time it answers; a verb without a parser binds the
      // flag as a positional and says so.
      expect(declared.code, `${verb} changed its exit code when handed a dec`).toBe(control.code);
      expect(declared.out, `${verb} changed its answer when handed a dec`).toBe(control.out);
    });
  }
});

describe('ws-add was this file\'s negative control, and D-410\'s remedy turned it into a positive one', () => {
  it('the argv wsAddWorker COMPOSES lands a declared actor in the create row, and the workspace it names', () => {
    // THE WHOLE CROSSING IN ONE TEST, and the reason it is not enough to know
    // that ccd refuses identically with and without the dec: the parity loop
    // above proves the flags are STRIPPED, and stripping them into nothing
    // would satisfy it exactly as well as recording them. `--surface`/`--actor`
    // exist to make a dispatched spawn distinguishable from an operator's own
    // add, and the only place that fact survives is the journal's `create` row.
    //
    // COMPOSED, never typed: `CCD_ARGV.wsAddWorker` builds the argv, real ccd
    // runs it, and `lifecycleHelpers` reads the row back. What used to stand
    // here was the same measurement with the opposite verdict — `invalid slug
    // '--surface'`, no worktree, no registry row.
    //
    // The exit status is deliberately not asserted: this fixture cannot finish
    // a spawn (rc 3, no output), which says nothing about the parse. The
    // artefacts do.
    h.makeRepo(PROJECT);
    runCcd(CCD_ARGV.wsAddWorker(PROJECT, PROBE_DEC));

    expect(uuidRows(), 'the flagged ws-add created no workspace — this is D-410 again')
      .toHaveLength(1);
    expect(fs.existsSync(path.join(h.home, 'worktrees', PROJECT)),
      'no worktree: the verb died before it built one').toBe(true);

    const created = eventsOf(h.home, 'create');
    expect(created, 'ws-add wrote no create line').toHaveLength(1);
    // BOTH PAIRS AND NOTHING ELSE. `toEqual` rather than two field reads: a dec
    // that gained a third pair here — a `--reason` this verb deliberately does
    // not take, say — is a change to what the journal records and must be read
    // by a human, not absorbed.
    expect(decOf(created[0]!)).toEqual({ surface: 'agent', actor: 'probe:dec parity' });
    // ...on the workspace the dispatch path would then have gone looking for.
    expect(measOf(created[0]!)['project']).toBe(PROJECT);
    expect(`${PROJECT}-${String(measOf(created[0]!)['workspace'])}.uuid`).toBe(uuidRows()[0]!);
  });

  it('and the same builder handed no dec still writes the row it always wrote — absence permits', () => {
    // The other direction, against the real binary: `decFlags(null)` composes
    // the bare three tokens an older ccd must keep receiving, and the row it
    // produces carries `surface: none` with NO actor at all. A `create` row
    // that gained a blank `dec.actor` would be a new fact — "somebody declared
    // nothing" — where today there is an honest silence.
    h.makeRepo(PROJECT);
    runCcd(CCD_ARGV.wsAddWorker(PROJECT, null));
    const created = eventsOf(h.home, 'create');
    expect(created, 'ws-add wrote no create line').toHaveLength(1);
    expect(decOf(created[0]!)).toEqual({ surface: 'none' });
  });

  // TASK 5's SECOND ARM. `decAppendingVerbs()` derives ccd VERBS, not builder
  // keys, and `wsAddAuto` emits the already-member verb `ws-add` — so the
  // derivation above is byte-identical whether or not this builder exists,
  // and the parity loop's `PROBES['ws-add']` composes through `wsAddWorker`
  // only. Without an arm here, `wsAddAuto`'s own token order — the dec lands
  // immediately after the project, with no `--no-rc` between — is measured by
  // NOTHING against the real binary; `whitelist-subset.test.ts` proves only
  // that the tokens cross the agent's prefix grant, not that ccd can parse
  // them in that position. This composes through `CCD_ARGV.wsAddAuto` itself
  // (never a hand-typed argv) and asserts the SAME create-row actor
  // `wsAddWorker`'s positive control landed above — the flags parse
  // identically whether or not `--no-rc` sits between the project and them.
  it('wsAddAuto composes the same create-row actor as wsAddWorker, with no --no-rc between the project and the flags', () => {
    h.makeRepo(PROJECT);
    runCcd(CCD_ARGV.wsAddAuto(PROJECT, PROBE_DEC));

    expect(uuidRows(), 'wsAddAuto created no workspace').toHaveLength(1);
    expect(fs.existsSync(path.join(h.home, 'worktrees', PROJECT)),
      'no worktree: the verb died before it built one').toBe(true);

    const created = eventsOf(h.home, 'create');
    expect(created, 'ws-add wrote no create line').toHaveLength(1);
    expect(decOf(created[0]!)).toEqual({ surface: 'agent', actor: 'probe:dec parity' });
    expect(measOf(created[0]!)['project']).toBe(PROJECT);
  });
});
