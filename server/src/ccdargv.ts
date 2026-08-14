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
  wsArchive: (id: string) => argv(['ws-archive', '--session', id]),
  wsRestore: (id: string) => argv(['ws-restore', '--session', id]),
  wsAudit:   (id: string) => argv(['ws-audit', '--session', id]),
  wsReap:    (tok: string, id: string) => argv(['ws-reap', '--expect', tok, '--session', id]),
  wsAttic:   (id: string) => argv(['ws-attic', '--session', id]),
  wsHold:    (id: string, reason: string) => argv(['ws-hold', '--session', id, '--reason', reason]),
  wsRelease: (id: string) => argv(['ws-release', '--session', id]),
  /** The second ccd write with no human in the loop — after `wsArchive`, which
   *  `FleetWatcher.archiveMerged` already fires unattended on merge — and the
   *  first whose argv is derived from model output. `--branch` carries a name
   *  `_ws_branch_valid` has NOT seen yet: validation lives on the box, once,
   *  and the server learns its verdict from the `bad-branch` refusal token. */
  wsRename:  (id: string, branch: string) => argv(['ws-rename', '--session', id, '--branch', branch]),
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
 * Reuses `verbSupported`'s exact mechanism and its exact null-permits
 * policy: `ccd caps` prints `stop-surface` as one more line in the same
 * list `verbSupported` already reads, chosen verb-shaped on purpose so
 * nothing new has to parse, carry or cache it (see `ccd/ccd`'s own comment
 * on the token, and `ccd-archive.test.ts`'s caps<->dispatcher parity check,
 * which pins it as a known non-dispatchable capability rather than letting
 * it silently pass as an undocumented verb).
 */
export function stopSurfaceSupported(state: Pick<FleetState, 'ccdVerbs'> | undefined): boolean {
  return verbSupported(state, ['stop-surface']);
}
