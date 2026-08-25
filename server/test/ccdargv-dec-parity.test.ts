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
// It has already cost once. `wsAddWorker` was given `...decFlags(dec)` on the
// argument that `actor-flags-v1` means "this box takes the flags" — and that
// token means something narrower, in ccd's own words (`ccd/ccd`, `cmd_caps`):
// it "decides ONE server-side thing: whether to APPEND `--surface`/`--actor`/
// `--reason` to the FIVE WORKSPACE VERBS". `ws-add` is not one of the five.
// `cmd_ws_add` consumes an exact-string `--no-rc` and then binds `slug="${2:-}"`
// with no flag parser at all, so the dec's first token lands in the SLUG and the
// verb dies at `_ws_slug_valid` — before a worktree, a registry row or a pane
// exists. Every wave-1 dispatch on a caps-advertising box would have refused,
// the registry diff would have found zero candidates, and the run would have sat
// at `planned` with `dispatchStartedAt` set: the exact wedge Build 9b exists to
// render, manufactured by the commit that renders it. 223 green server files saw
// none of it.
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
 * someone believed it sends. Every entry names a session/project that does not
 * exist, so real ccd refuses for a reason of its own and touches nothing —
 * which is the point: a verb that PARSES the dec strips it before it binds
 * positionals, and so gives byte-identical refusals with and without it. A verb
 * that does not parse it gives a DIFFERENT refusal, naming the flag.
 */
const ABSENT = '__no-such-session__';
const PROBES: Record<string, (dec: ActorFlags | null) => readonly string[]> = {
  'ws-archive': (d) => CCD_ARGV.wsArchive(ABSENT, d),
  'ws-restore': (d) => CCD_ARGV.wsRestore(ABSENT, d),
  'ws-hold': (d) => CCD_ARGV.wsHold(ABSENT, 'probe reason', d),
  'ws-release': (d) => CCD_ARGV.wsRelease(ABSENT, d),
  'ws-rename': (d) => CCD_ARGV.wsRename(ABSENT, 'ws/probe', d),
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
  it('derives the dec-appending verbs from the table, and finds the five workspace verbs — no more', () => {
    // BOTH DIRECTIONS, and the second one is the one this suite was written
    // for. A verb ADDED here without a ccd that parses it is caught by the
    // execution test below; a verb SILENTLY added is caught right here, because
    // the derivation cannot miss it and this equality cannot absorb it. The set
    // is ccd's own sentence, said in TypeScript: `actor-flags-v1` gates the five
    // WORKSPACE verbs, and nothing else.
    expect(decAppendingVerbs())
      .toEqual(['ws-archive', 'ws-hold', 'ws-release', 'ws-rename', 'ws-restore']);
  });

  it('has a probe for every derived verb — a new one cannot join unmeasured', () => {
    // The anti-whitelist clause. If `PROBES` were merely consulted, a builder
    // that gained a dec with no probe entry would be skipped in silence, which
    // is the same defect shape as the `BUILDERS` name-list this file replaces.
    expect(decAppendingVerbs().filter((v) => !(v in PROBES))).toEqual([]);
  });

  for (const verb of decAppendingVerbs()) {
    it(`${verb}: real ccd refuses identically with and without the dec — the flags are parsed, not bound`, () => {
      const probe = PROBES[verb]!;
      const control = runCcd(probe(null));
      const declared = runCcd(probe(PROBE_DEC));
      // Byte-identical: same exit code, same words. A verb whose parser strips
      // `--surface`/`--actor` before positional binding cannot tell these two
      // calls apart by the time it refuses; a verb without a parser binds the
      // flag as a positional and says so.
      expect(declared.code, `${verb} changed its exit code when handed a dec`).toBe(control.code);
      expect(declared.out, `${verb} changed its refusal when handed a dec`).toBe(control.out);
      // ...and the control really did refuse, FOR THE FIXTURE'S REASON. Two
      // identical no-ops — or two identical successes — would satisfy the
      // equality above while measuring nothing, so the refusal must name the
      // session that is absent. That is also what proves the flags were
      // stripped BEFORE positional binding rather than merely tolerated: a verb
      // that bound `--surface` as its session would refuse naming the flag.
      expect(control.out, `${verb}'s control probe did not refuse for the absent session`)
        .toContain(ABSENT);
    });
  }
});

describe('ws-add is the negative control, and it is a measurement', () => {
  it('is NOT in the derived set — wsAddWorker composes no dec', () => {
    // The assertion that would have gone red on the commit this suite exists
    // because of, in one line, red-first. It is not a preference: the test
    // below measures WHY.
    expect(decAppendingVerbs()).not.toContain('ws-add');
  });

  it('real ccd binds the dec\'s first token as the SLUG and dies before creating anything', () => {
    // The refusal, quoted from the binary rather than from a belief about it.
    // `cmd_ws_add` shifts an exact-string `--no-rc`, binds `project="$1"` and
    // `slug="${2:-}"`, and has no flag loop — so `--surface` arrives as the
    // slug and `_ws_slug_valid`'s `^[a-z0-9][a-z0-9-]{1,30}$` refuses it. The
    // argv below is spelled out rather than composed, deliberately: it is the
    // shape `wsAddWorker` MUST NOT compose, so no builder may be able to
    // produce it, and this is what the sentence looks like when it is wrong.
    h.makeRepo('demo');
    const declared = runCcd(
      ['ws-add', '--no-rc', 'demo', '--surface', 'agent', '--actor', 'run:7 dispatch']);
    expect(declared.code).not.toBe(0);
    expect(declared.out).toMatch(/invalid slug '--surface'/);
    // Nothing was created. This is the half that makes the wedge concrete: the
    // verb dies before the worktree, before the registry row, before the pane,
    // so the dispatch's registry diff finds zero new candidates and the run is
    // left at `planned` with a dispatch it can never complete. `.uuid` is the
    // row-exists field the registry is read through everywhere else — the
    // `.ws-add-demo.lock` the flock leaves behind is not a session and is not
    // counted as one.
    expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo'))).toBe(false);
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((f) => f.endsWith('.uuid')))
      .toEqual([]);
  });
});
