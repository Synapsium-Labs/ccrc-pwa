import type { FleetState } from './fleetstate.js';
import type { StopSurface } from '../../shared/api.js';

declare const CcdArgvBrand: unique symbol;

/**
 * A ccd argv that provably came from `CCD_ARGV`. The brand is phantom — it
 * exists only in the type system — so this costs nothing at runtime, and an
 * ordinary `string[]` (however it was built or named) is not assignable to it.
 * That is the whole mechanism: layer 2b of `whitelist-subset.test.ts` used to
 * police this by scanning source text and was defeated in four consecutive
 * rounds by four different ways of naming a value (inline literal, extracted
 * const, aliased runner, renamed identifier). A text scan over a
 * Turing-complete language cannot enumerate the ways to name a value; a type
 * does not have to. See task 13S.
 *
 * WHAT STILL GETS PAST IT (pre-merge fix round, finding 13S-F1 — corrected
 * from an earlier, narrower claim of "a deliberate cast" as the only
 * residual class): a deliberate cast (`['ws-rm','x'] as unknown as
 * CcdArgv`); array covariance (`const w: (readonly string[])[] = slots;
 * w[0] = [...]`); or any `any`-typed value flowing in uncast (e.g.
 * `JSON.parse(...)`). All three are inherent to TypeScript's structural and
 * gradual typing and cannot be closed by a stronger brand — this is an
 * accurate disclosure of the residual class, not a claim that the brand is
 * total. A fourth shape, `Object.assign` onto a minted argv, IS closed — see
 * `argv()`'s own comment below.
 */
export type CcdArgv = readonly string[] & { readonly [CcdArgvBrand]: true };

/**
 * The ONLY place a `string[]` becomes a `CcdArgv`, and it lives in the file
 * whose entire job is building them. Every entry in `CCD_ARGV` returns through
 * here, and nothing outside this file can mint one — which is what makes
 * `Deps.runCcd`'s parameter type a proof of origin rather than a hint.
 *
 * `Object.freeze` (pre-merge fix round, finding 13S-F1): without it,
 * `Object.assign(CCD_ARGV.ensure('x'), ['ws-rm', 'evil'])` types as
 * `CcdArgv & string[]` — no cast anywhere — and MUTATES THE REAL ARGV IN
 * PLACE at runtime (measured). Freezing here makes that assignment throw
 * (`Object.assign`'s own internal `Set(..., throw)` fails closed on a
 * non-writable index) instead of silently succeeding. This closes exactly
 * that one shape. It does not and cannot close array covariance
 * (`const w: (readonly string[])[] = slots; w[0] = [...]`) or an
 * `any`-typed value flowing in uncast (e.g. `JSON.parse(...)`) — both are
 * inherent to TypeScript, not bugs in this function.
 */
const argv = (parts: readonly string[]): CcdArgv => Object.freeze(parts) as CcdArgv;

/**
 * The DECLARED half of a provenance record (spec D2's `dec`), as the three ccd
 * flags carry it. Self-asserted by construction — ccd cannot authenticate a
 * caller on a single-uid box and does not pretend to; the kernel-observed half
 * (`obs`) is measured on the box and the two are COMPARED, never merged.
 *
 * THE PRODUCER SHAPE, and `LifecycleDec` (L0) is the RECORD shape it lands as.
 * They differ in exactly two places and both differences are deliberate:
 * `surface` here is `StopSurface` and NEVER `'none'` (absence is `dec: null`,
 * which omits the flags entirely), while the record's is
 * `DecSurface = StopSurface | 'none'`; and `actor` here is MANDATORY because
 * `deviceActor`/`sweepDec` always measure one, while the record's is nullable
 * because an older ccd may have written none. `capsupported.test.ts` pins the
 * assignability so nobody "unifies" the two later.
 *
 * `reason: null` OMITS the flag. It is not `''`: ccd refuses a blank
 * declaration (`_lc_dec_ok`), on the same argument `cmd_ws_hold` has always
 * made about an empty hold reason — a flag that says nothing is a different
 * fact from no flag, and collapsing them records "nobody said" for a caller
 * that said something unusable.
 */
export interface ActorFlags {
  readonly surface: StopSurface;
  readonly actor: string;
  readonly reason: string | null;
}

/**
 * The flag tokens for a dec, or NOTHING for `null`.
 *
 * `null` is a real, deliberate choice and not "unset" — it is what a caller
 * passes when the deployed ccd is not known to understand the flags
 * (`capSupported(state, ACTOR_FLAGS_CAP)`), and it produces the argv that
 * shipped before this wave, token for token. Exactly `stopId`'s
 * `surface: null` contract, for exactly its reason (`ccdargv.ts:76-91`).
 *
 * MEASURED (task 52 verification): the check below is `dec === null ||
 * dec === undefined` — not `dec === null` alone. This build's five threaded
 * call sites in
 * `server.ts`/`watch.ts`/`coord/close.ts`/`coord/dispatch.ts`/`coord/routes.ts`
 * are threaded in Tasks 54-55, not here, so between this commit and theirs
 * every one of them is still calling e.g. `wsArchive(id)` with the new third
 * parameter simply absent. `tsc` catches that loudly (TS2554, disclosed and
 * expected-red until Task 55) — but vitest's esbuild transform does not
 * enforce arity, so at RUNTIME `dec` arrives as `undefined`, not `null`, and
 * `dec === null` is false for it. Measured before this widening: 412 tests
 * across 13 files failed, including an unhandled rejection
 * (`TypeError: Cannot read properties of undefined (reading 'surface')`) from
 * `FleetWatcher.sweepNames`'s `CCD_ARGV.wsRename` call. `undefined` here is
 * not a caller's deliberate third state — nothing above ever constructs an
 * `ActorFlags | undefined`, only `ActorFlags | null` — so treating it like
 * `null` collapses no meaningful distinction; it is purely runtime tolerance
 * for a call-arity gap the type checker already flags.
 */
const decFlags = (dec: ActorFlags | null): readonly string[] =>
  dec === null || dec === undefined
    ? []
    : ['--surface', dec.surface, '--actor', dec.actor,
       ...(dec.reason === null ? [] : ['--reason', dec.reason])];

/**
 * The session's own device label as an `--actor` value.
 *
 * TWO CONDITIONS, TWO WORDS. `null` means the gate measured no session at all
 * (a dark box, or an exempt route reached without a cookie) — `unmeasured`. A
 * UA-less browser that DID present a live session already carries
 * `'unknown device'` from `deviceLabel` and keeps it verbatim. Folding both
 * into one word would tell an operator "we do not know which browser" for a
 * call where we do not know there was a browser.
 *
 * `\p{Cc}` flattens every control character and the label is re-truncated, both
 * belt and braces: `deviceLabel` already slices to 120 UTF-16 units, and ccd
 * quotes the value through `_lc_json` (which escapes a newline rather than
 * breaking the line). A producer that can cheaply guarantee it never emits a
 * line break into a line-oriented file should. 7 + 120*3 = 367 bytes worst
 * case, inside ccd's 512-byte `--actor` cap. The unicode property escape is
 * used rather than an explicit code-point range so this source file contains no
 * control characters of its own.
 *
 * DISCLOSED RESIDUAL (AUDIT m5): `slice(0, 120)` counts UTF-16 units, so it can
 * split a surrogate pair and leave a lone surrogate at the end. Harmless in
 * both directions — `JSON.stringify` escapes it, and ccd's `_lc_json` decodes
 * with `errors='replace'`, so it lands as U+FFFD — and it is written down here
 * rather than left for someone to rediscover.
 */
export function deviceActor(device: string | null): string {
  if (device === null) return 'device:unmeasured';
  return `device:${device.replace(/\p{Cc}/gu, ' ').slice(0, 120)}`;
}

/**
 * The ONLY place ccd argv is constructed. Every route builds its call through
 * this table, and `whitelist-subset.test.ts` enumerates the table against the
 * agent's EXEC_WHITELIST in both directions. An argv the enumeration cannot see
 * is exactly how `ws-add`/`ws-rm` shipped whitelisted-out and dead on the fleet
 * with every suite green — so there is deliberately no other way to obtain the
 * `CcdArgv` that `Deps.runCcd` demands.
 */
export const CCD_ARGV = {
  start:     (w: string, p: string, wd?: string) => argv(['start', w, p, ...(wd ? [wd] : [])]),
  /** `enable` is `start` plus the systemd enable, and it is what
   *  `POST /api/sessions` sends unless the body says `enable: false`. It is a
   *  separate entry because the two words are separate grants in the agent's
   *  list, and because layer 3 fails if a grant nothing builds is left over. */
  enable:    (w: string, p: string, wd?: string) => argv(['enable', w, p, ...(wd ? [wd] : [])]),
  ensure:    (id: string) => argv(['ensure', id]),
  /** `surface` is REQUIRED, not defaulted — the caller always knows who is
   *  asking, and a default here would be how a second caller quietly
   *  inherits the wrong word — but it is nullable, and `null` is a real,
   *  DELIBERATE choice, not "unset": it means the flag is OMITTED entirely,
   *  which is what a caller must pass when the deployed ccd is not known to
   *  understand `--surface` (`stopSurfaceSupported`, below). `--surface`
   *  rides as an argv flag rather than an env var for the reason
   *  `README.md`'s exec-whitelist section gives: the exec seam is `Runner =
   *  (cmd, args) => …` with no env, and a `CCD_SURFACE` variable would
   *  report the SERVER PROCESS's own environment identically for every
   *  caller.
   *
   *  FIX ROUND 2 (task 14 follow-up, Important #1): before this, `surface`
   *  was unconditionally required and always sent — measured against
   *  `origin/main`'s pre-flag ccd (the shape deployed on this fleet until
   *  the SECOND of two independent deploy commands runs, per
   *  `deploy/deploy.sh`'s own ordering, which does not cross-check the
   *  other target's version): `ccd stop <id> --surface pwa` parsed as a
   *  TWO-ARGUMENT stop of a session literally named `<id>---surface`, which
   *  that old ccd's positional arity rule then happily recomputed and
   *  "stopped" — exit 0, nothing real touched, the actual session's unit
   *  left enabled. `runCcdOr502` reads that exit 0 as `200 {ok:true}`: a
   *  control that reports success while doing nothing, the exact defect
   *  class this whole branch exists to remove — and this fix introduced it.
   *  `null` is how the caller now says "this box might not understand the
   *  flag yet" instead of finding out from a fleet-wide stop that silently
   *  never happens. */
  stopId:    (id: string, surface: StopSurface | null) =>
               argv(surface === null ? ['stop', id] : ['stop', id, '--surface', surface]),
  stopPair:  (w: string, p: string, surface: StopSurface | null) =>
               argv(surface === null ? ['stop', w, p] : ['stop', w, p, '--surface', surface]),
  /** Registry-only removal of a DEAD non-workspace session — the end-of-life
   *  plain sessions never had. ccd re-proves every gate on the box (not a
   *  workspace, not held, not alive); this argv carries nothing but the id. */
  forget:    (id: string) => argv(['forget', id]),
  swap:      (id: string, w: string) => argv(['swap', id, w]),
  wsAdd:     (p: string) => argv(['ws-add', p]),
  prStateSession: (id: string) => argv(['pr-state', '--session', id]),
  prStateProject: (p: string)  => argv(['pr-state', '--project', p]),
  prOpen:    (id: string, t: string, b64: string, draft: boolean) =>
               argv(['pr-open', '--session', id, '--title', t, '--body-b64', b64, '--draft', draft ? 'true' : 'false']),
  wsArchive: (id: string, dec: ActorFlags | null) =>
               argv(['ws-archive', '--session', id, ...decFlags(dec)]),
  wsRestore: (id: string, dec: ActorFlags | null) =>
               argv(['ws-restore', '--session', id, ...decFlags(dec)]),
  wsAudit:   (id: string) => argv(['ws-audit', '--session', id]),
  wsReap:    (tok: string, id: string) => argv(['ws-reap', '--expect', tok, '--session', id]),
  wsAttic:   (id: string) => argv(['ws-attic', '--session', id]),
  /** The dec flags ride AFTER `--reason`, and `--reason` is NOT one of them: on
   *  `ws-hold` the hold reason IS the declared reason (ccd's `cmd_ws_hold` says
   *  so in its own comment), so there is one reason on this verb, not two. The
   *  `{ ...dec, reason: null }` is what enforces it here — a caller that passes
   *  a dec carrying a reason gets it dropped, pinned in `capsupported.test.ts`.
   *
   *  MEASURED: the ternary must check `dec === undefined` too, not just
   *  `dec === null` — `{ ...undefined, reason: null }` does NOT throw, it
   *  evaluates to `{ reason: null }` (object spread of `undefined` is a
   *  silent no-op, unlike array spread), so a not-yet-threaded caller passing
   *  only two arguments fed `decFlags` a bogus dec with `surface`/`actor`
   *  both `undefined` instead of routing to the omit-everything branch.
   *  `decFlags` itself no longer throws on that (see its own docstring), but
   *  it did emit `undefined` into the argv array — invalid input to the
   *  exec seam. Reproduced via `run-routes.test.ts`'s dispatch suite
   *  returning 500 instead of 200/502/409 before this fix. */
  wsHold:    (id: string, reason: string, dec: ActorFlags | null) =>
               argv(['ws-hold', '--session', id, '--reason', reason,
                     ...decFlags(dec === null || dec === undefined ? dec : { ...dec, reason: null })]),
  wsRelease: (id: string, dec: ActorFlags | null) =>
               argv(['ws-release', '--session', id, ...decFlags(dec)]),
  /** The second ccd write with no human in the loop — after `wsArchive`, which
   *  `FleetWatcher.archiveMerged` already fires unattended on merge — and the
   *  first whose argv is derived from model output. `--branch` carries a name
   *  `_ws_branch_valid` has NOT seen yet: validation lives on the box, once,
   *  and the server learns its verdict from the `bad-branch` refusal token. */
  wsRename:  (id: string, branch: string, dec: ActorFlags | null) =>
               argv(['ws-rename', '--session', id, '--branch', branch, ...decFlags(dec)]),
  /** The pause marker's writer (Build 4, spec §4.2). `state` is a two-member
   *  union rather than a string: `POST /api/coord/pause` takes a boolean, and
   *  the on|off vocabulary is ccd's — the mapping happens once, at the call
   *  site, so no route can invent a third word the verb would `die` on. */
  coordPause: (state: 'on' | 'off') => argv(['coord-pause', '--state', state]),
} as const;

/**
 * Whether the DEPLOYED ccd on the fleet host implements this argv's verb, per
 * the `ccd caps` list the agent advertised at handshake. `ccdVerbs === null`
 * means we have no evidence (local mode, or an agent old enough not to send
 * it) and permits everything — an absent list must never grey out the fleet.
 */
export function verbSupported(
  state: Pick<FleetState, 'ccdVerbs'> | undefined,
  argv: readonly string[],
): boolean {
  const verbs = state?.ccdVerbs ?? null;
  if (verbs === null) return true;
  return verbs.includes(argv[0] ?? '');
}

/** The `ccd caps` token that says this box parses `--surface`/`--actor`/
 *  `--reason` on the five workspace verbs (wave 5). Spelled ONCE in
 *  `server/src`: `server.ts`'s `pwaDec` reads it from here (wave 6), because a
 *  capability token copied into two files is the drift shape
 *  `single-definition.test.ts` exists for. ccd's own `echo actor-flags-v1` and
 *  `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two
 *  spellings, and a parity check keeps THOSE two equal (`ccd-archive.test.ts`'s
 *  `advertises exactly the verbs...` case) — that same test now also imports
 *  THIS constant and asserts `KNOWN_CAPABILITY_TOKENS` contains it (wave 6),
 *  closing the gap this docstring used to disclose: before that line existed,
 *  corrupting this literal reddened only `capsupported.test.ts`'s own
 *  self-check, nothing cross-file (measured by mutation). RULE 8 still
 *  applies to `single-definition.test.ts` itself — it has no hand-written
 *  finding for this vocabulary, so its own green run is not what proves the
 *  parity; the `toContain` assertion above is. */
export const ACTOR_FLAGS_CAP = 'actor-flags-v1';

/**
 * Whether the DEPLOYED ccd advertised a CAPABILITY token — a verb-shaped string
 * in the same `ccd caps` list `verbSupported` reads, naming a FLAG on an
 * existing verb rather than a second dispatchable command.
 *
 * THE NO-EVIDENCE DEFAULT IS FALSE, and it is deliberately the opposite of
 * `verbSupported`'s. That asymmetry is argued in full on
 * {@link stopSurfaceSupported} below and is not restated here — what matters at
 * this seam is that generalising the FUNCTION must not generalise the DEFAULT
 * along with it. For a gated VERB, a wrong guess on no evidence costs a loud
 * failure (ccd's own `die "usage: ..."`, a 502, never a lie). For a FLAG, a
 * wrong guess costs a SILENT SUCCESS: an old ccd meets the flag inside an
 * exact-arity guard, and on the paths where it does not die, `runCcdOr502`
 * renders its exit 0 as `200 {ok:true}` for a call that recorded nothing. Same
 * input, categorically different blast radius.
 *
 * This is sound only because local mode measures its OWN ccd at boot
 * (`localcaps.ts`, `index.ts`) rather than leaving `ccdVerbs` permanently null
 * there — otherwise a refusing default would kill the feature outright in the
 * DEFAULT deployment mode.
 */
export function capSupported(
  state: Pick<FleetState, 'ccdVerbs'> | undefined,
  token: string,
): boolean {
  const verbs = state?.ccdVerbs ?? null;
  if (verbs === null) return false;
  return verbs.includes(token);
}

/**
 * Whether the deployed ccd understands `--surface` on `stop` (fix round 2,
 * task 14, Important #1). A CAPABILITY, not a verb — `stop` itself is
 * `UNGATED_BY_DECISION` (`verb-gate.test.ts`) because every ccd generation
 * has always understood the bare verb; only the FLAG is skew-exposed, and
 * this function is named separately from `verbSupported` (rather than
 * called inline at the call site) specifically so the verb-gate scanner's
 * text search for `verbSupported(` inside a call site's enclosing function
 * does not mark `stop`'s own call sites as gated — they still are not,
 * correctly, since the verb always goes through.
 *
 * `ccd caps` prints `stop-surface` as one more line in the exact list
 * `verbSupported` reads, chosen verb-shaped on purpose so nothing new has
 * to parse, carry or cache it (see `ccd/ccd`'s own comment on the token,
 * and `ccd-archive.test.ts`'s caps<->dispatcher parity check, which pins it
 * as a known non-dispatchable capability rather than letting it silently
 * pass as an undocumented verb) — the membership test below is the same
 * shape `verbSupported` uses for that reason.
 *
 * THE NO-EVIDENCE DEFAULT IS DELIBERATELY THE OPPOSITE OF `verbSupported`'s
 * (fix round 3, task 14, Important #2 — the plan owner's ruling, recorded
 * here rather than merely applied): for every OTHER gated verb, guessing
 * wrong when `ccdVerbs` is null costs a LOUD failure — ccd's own `die
 * "usage: …"`, a 502, never a lie — so permitting on no evidence is the
 * safe default there, and stays unchanged; `verbSupported` itself must NOT
 * be touched. For `--surface`, guessing wrong costs a SILENT SUCCESS: an
 * old ccd parses `stop <id> --surface pwa` as a two-argument stop of a
 * session literally named `<id>---surface`, exits 0, and the real session
 * is never touched — `runCcdOr502` then answers `200 {ok:true}` for a stop
 * that did nothing. Same "no evidence" input, categorically different
 * blast radius on the wrong guess: refusing costs a `cli` stamp instead of
 * `pwa`; permitting wrongly costs a control that lies about success. The
 * asymmetry is why this function does not delegate to `verbSupported`. It
 * delegates to {@link capSupported} instead (wave 6), which is that same
 * membership check with this opposite default — one implementation of the
 * refusing branch, not two, and `readme-holds.test.ts` pins BOTH halves so a
 * quiet re-implementation here with the permitting default still reds.
 *
 * It stays a NAMED EXPORT rather than becoming a call site: `verb-gate.test.ts`
 * text-searches a call site's enclosing function for `verbSupported(`, and
 * inlining `capSupported(state, 'stop-surface')` at `stop`'s call sites would
 * change what that scanner sees about a verb that is correctly ungated.
 *
 * This default is only sound because local mode ALSO now measures real
 * evidence at boot (`localcaps.ts`, `index.ts`) rather than leaving
 * `ccdVerbs` permanently null there — otherwise inverting this default
 * would have killed the surface feature outright in local mode, the
 * DEFAULT deployment mode (`deploy/ccrc.env.example`'s `CCRC_FLEET=local`).
 */
export function stopSurfaceSupported(state: Pick<FleetState, 'ccdVerbs'> | undefined): boolean {
  return capSupported(state, 'stop-surface');
}
