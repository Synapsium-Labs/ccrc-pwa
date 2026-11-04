import path from 'node:path';
import type { CcdArgv } from './ccdargv.js';
import type { CcrcConfig } from './config.js';
import type { Runner } from './exec.js';
// D-5896: the word from its pure leaf; through `exec.ts` this file loaded `node:child_process`.
import { UNMEASURED, type Unmeasured } from './unmeasured.js';
import type { FleetIO } from './io.js';
import type { ProjectRow } from '../../shared/api.js';
import type { CcdResult, RunCcd } from './coord/ports.js';
import { readRegistryMeasured } from './registry.js';
import { mapBounded } from './bounded.js';

// D-6003: `CcdResult` and its runner's type are L2 ports in `coord/ports.ts`, beside their consumers; re-exported
// here so every importer of this file still compiles.
export type { CcdResult } from './coord/ports.js';

/** Run `ccd <args...>` through the injected Runner; ok = exit code 0. The argv
 *  is a `CcdArgv`, so it can only have been built by `ccdargv.ts` — there is no
 *  other way to obtain a value of that type (task 13S). */
export async function ccd(run: Runner, cfg: CcrcConfig, args: CcdArgv): Promise<CcdResult> {
  const r = await run(cfg.ccdBin, [...args]);
  // The one hop that turns the optional shape into the token shape. `=== undefined`
  // is the whole test: absence — and ONLY absence — becomes `UNMEASURED`. A
  // measured `false` stays `false`, and a measured `null` signal stays `null`.
  const answer: CcdResult = {
    ran: true, ok: r.code === 0, stdout: r.stdout, stderr: r.stderr,
    killed: r.killed === undefined ? UNMEASURED : r.killed,
    signal: r.signal === undefined ? UNMEASURED : r.signal,
  };
  // D-6034: the runner's `ran: false` arm is CARRIED, beside every field above, unchanged.
  // `ok: false` is the arm's own claim, never derived from the forged code.
  return r.ran === false ? { ...answer, ok: false, ran: false, reason: r.reason, detail: r.detail } : answer;
}

/** How one ccd call ENDED, as its two kill halves together say (docs W2, refinement (g)):
 *  - `deadline`: the runner's own deadline fired (`killed === true`), whatever `signal` says;
 *  - `signal`: a MEASURED, non-null signal ended the child without the deadline — an operator, an OOM reaper,
 *    systemd stopping the unit;
 *  - `unmeasured`: nobody measured the signal half (an older agent, the transport catch path);
 *  - `exited`: a measured `signal: null` — the child exited by itself, with whatever code `ok` reports.
 *  Four kinds, never folded: a caller that needs fewer (`cutShort`) folds them itself. */
export type CcdEnding = { kind: 'unmeasured' } | { kind: 'deadline' } | { kind: 'signal'; signal: string } | { kind: 'exited' };

/** THE SINGLE READER of `CcdResult`'s `killed` and `signal` (wire discipline): `cutShort` below and the docs
 *  adapter (`docs/ccdsource.ts`) both read the two halves through here, so they are never interpreted twice in two
 *  places that could drift apart. `cutShort`'s docstring argues each arm; the order is its order.
 *
 *  The token trap `cutShort` names applies here first: `UNMEASURED` is itself a string, so the signal half is
 *  compared with the token BEFORE it is read as a signal name, never tested by its javascript type. */
export function ccdEnding(r: CcdResult): CcdEnding {
  if (r.killed === true) return { kind: 'deadline' };
  if (r.signal === UNMEASURED) return { kind: 'unmeasured' };
  if (r.signal !== null) return { kind: 'signal', signal: r.signal };
  return { kind: 'exited' };
}

/** "THIS CALL'S CHILD WAS CUT SHORT" — the single fact §1.5's adoption gate
 *  rests on. It reads `killed` and `signal` through {@link ccdEnding}, their
 *  single reader (wire discipline), so the two halves of one measurement are
 *  never interpreted twice in two places that could drift apart: `deadline`
 *  and `signal` are `true`, `unmeasured` is `UNMEASURED`, `exited` is `false`.
 *
 *  Neither half implies the other. `killed` is true only when the runner's own
 *  deadline fired; an EXTERNAL kill (operator, OOM reaper, systemd stopping the
 *  unit mid-`ws-add`) arrives `killed: false` with `signal: 'SIGKILL'`, and it
 *  leaves behind exactly the same orphan a deadline kill does — a worktree, a
 *  branch and every registry row, written before `_spawn` blocked. That is what
 *  makes it the same fact rather than a near neighbour.
 *
 *  Tri-state on purpose: `UNMEASURED` when NOTHING was measured (an older agent
 *  sent neither field; the transport catch path measured nothing by
 *  construction), so a caller cannot mistake ignorance for a clean refusal. Only
 *  a literal `true` may adopt.
 *
 *  THE SIGNAL HALF IS THE DECIDING ONE, and `killed` only ever fast-paths a
 *  `true`. `killed: false` proves one thing — node did not kill this child at
 *  its own deadline — and says nothing about the external kill (operator, OOM
 *  reaper, systemd stopping the unit) that the paragraph above exists to catch;
 *  answering `false` off it alone would claim a measurement nobody made, for
 *  exactly the half this function was widened to read. So `killed: false,
 *  signal: UNMEASURED` is UNMEASURED. The mirror shape is sound and stays
 *  `false`: a deadline kill would have shown SIGTERM, so a MEASURED `signal:
 *  null` rules out both kinds of kill on its own, whatever `killed` says.
 *  Latent rather than live — every producer in this tree sends both halves or
 *  neither — but `asExecResult` spreads the two fields independently, so a peer
 *  frame carrying one and not the other reaches here.
 *
 *  THE ONE TRAP THIS FUNCTION HAS TO STEP AROUND, written down because it cost a
 *  green suite once: `UNMEASURED` is itself a STRING, so `typeof r.signal ===
 *  'string'` is TRUE for it. A signal name has to be checked as "measured AND not
 *  null", never by its javascript type, or the token — the value that exists
 *  precisely to mean "nobody looked" — reads as the strongest possible evidence
 *  and adopts a workspace on a dropped socket. That is the exact class of bug the
 *  token was introduced to close, arriving through the token itself. */
export function cutShort(r: CcdResult): boolean | Unmeasured {
  const ending = ccdEnding(r);
  if (ending.kind === 'unmeasured') return UNMEASURED;
  return ending.kind !== 'exited';
}

/** The single ccd capability `Deps` carries in place of a raw `Runner`. */
export type CcdRunner = RunCcd;

/** Composition-root factory: binds a `Runner` and a config into the one
 *  capability every downstream module gets. Holding only the result, a route
 *  has no runner to reach and no value of the right type to invent — which is
 *  the property layer 2b used to police by scanning source text. */
export const ccdRunner = (run: Runner, cfg: CcrcConfig): CcdRunner =>
  (argv) => ccd(run, cfg, argv);

/** A linked worktree (or submodule) masquerading as a project: `.git` exists
 *  but is a FILE. D-5967: the file-vs-dir answer is `lstatMeasured` on
 *  `<workdir>/.git`, and ONLY a measured `regular` file condemns — a directory
 *  (`other`) is a main checkout, a symlink is kept as it always was, and a
 *  probe that could not answer (a remote timeout, an agent too old for the
 *  `lstat` op, a permission error) keeps the project. Before this, a null
 *  `readdir` of `.git` was read as "it is a file", so a transient failure
 *  dropped a real project. A dir with NO .git at all is a legitimate non-git
 *  project (four exist on the fleet) and must never be skipped; an UNREADABLE
 *  workdir stays listed — this probe only ever removes what it positively
 *  identified.
 *  `names`, when given, is a `readdir(workdir)` result the caller already
 *  holds (the root loop's directory-ness probe) — reused here so that door
 *  doesn't readdir the same directory twice; the union loop has no such
 *  listing yet and omits the argument, so this reads workdir itself. */
const isLinkedWorktree = async (
  io: FleetIO,
  workdir: string,
  names?: string[] | null,
): Promise<boolean> => {
  const entries = names === undefined ? await io.readdir(workdir) : names;
  if (entries === null || !entries.includes('.git')) return false;
  const kind = await io.lstatMeasured(path.join(workdir, '.git'));
  return kind.ok && kind.kind === 'regular'; // D-5967: unmeasured keeps
};

/** The walk's reads in flight at once (desktop polish C4, D-6436), through the one bounded pool (`bounded.ts`). Each
 *  slot is one directory: its listing, then its `.git` probe, in that order, so never more than this many reads are
 *  out at once. */
export const PROJECT_WALK_CONCURRENCY = 8;

/** How long `ProjectWalkCache` keeps the root walk and each probe's verdict (D-6436). */
export const PROJECT_WALK_TTL_MS = 30_000;

/** How old the watcher's latest listed tick may be, measured from when its registry read BEGAN, before
 *  `GET /api/projects` reads the registry itself instead (D-6436). Set by C4's Step 0 at about two ticks: on the
 *  base, a tick over 80 rows took about 7 s at 60 ms a request (about 9.6 s with every sweep due), and the listing
 *  a route reads can be up to a tick and a poll interval older than the newest one. */
export const FLEET_ROWS_MAX_AGE_MS = 20_000;

/** A registry row as `listProjects` reads it: a `SessionRecord` and a `FleetSession` both carry these two verbatim. */
export interface ProjectSourceRow { readonly project: string; readonly workdir: string }

/** The watcher's latest listing, as the route hands it over: `listedAt` is when that tick's registry read began.
 *  Structural, so this file never imports `watch.ts`. */
export interface FleetRowsListing { readonly sessions: readonly ProjectSourceRow[]; readonly listedAt: number }

/**
 * Whether the watcher's listing may stand in for `listProjects`'s own registry read (D-6436). Pure. `null` means
 * "read the registry yourself": there is no listing (no broadcast yet, or the latest tick could not list), or it is
 * `boundMs` or more old, or its stamp is in the future (a clock that stepped back proves nothing about its age).
 * The caller passes `null` for a tick that did not list, so a stale or unlistable tick never answers `'listed'`.
 */
export function fleetRowsUsable(
  listing: FleetRowsListing | null,
  nowMs: number,
  boundMs: number,
): readonly ProjectSourceRow[] | null {
  if (listing === null) return null;
  const age = nowMs - listing.listedAt;
  return age >= 0 && age < boundMs ? listing.sessions : null;
}

/**
 * The projects route's cache of what changes slowly (D-6436): the walk of `cfg.projectsRoot` and each registry
 * workdir's linked-worktree verdict, each for `PROJECT_WALK_TTL_MS` on the injected clock. A failed root listing is
 * never kept, so the next request walks again. Pools, limits, shares, readiness and repo cells are never cached
 * here, so a pool write shows on the next request.
 *
 * Only what was MEASURED is kept (review 1375, F2): a probe that could not answer keeps its row for that request, as
 * D-5967 says, but its verdict is not kept, and a walk with such a slot is not kept either. Each walk and probe is
 * stamped when it STARTS, and its result replaces a kept one only over an older stamp (F3), so, while the kept walk is
 * fresh, an older listing that finishes last never overwrites a newer one; freshness is measured from that start. An
 * entry whose age reads negative (the clock stepped back past its stamp) is dropped the first time it is asked for
 * (review 1383 F2); one never asked for while the clock is behind it is served again once the clock reaches its stamp,
 * the residual of a wall clock (`fleetRowsUsable` reads the same one).
 *
 * Kept on purpose, and said once:
 * - an entry under the root whose listing failed is left out of a kept walk as it is left out of today's one answer
 *   (`readdir` cannot tell a plain file from a dropped read), so such a gap lasts up to the TTL rather than one request;
 * - there is no single flight: k cold requests that overlap each walk, so together they may hold 8 x k reads.
 */
export class ProjectWalkCache {
  private walk: { at: number; rows: readonly ProjectRow[] } | null = null;
  private readonly probes = new Map<string, { at: number; linked: boolean }>();

  constructor(private readonly now: () => number = () => Date.now(), private readonly ttlMs = PROJECT_WALK_TTL_MS) {}

  private fresh(at: number): boolean {
    const age = this.now() - at;
    return age >= 0 && age < this.ttlMs;
  }

  /** Whether an entry stamped `at` reads a negative age: the clock stepped back past its stamp. Such an entry is DROPPED
   *  the first time it is asked for (review 1383 F2), so it cannot read fresh again once the clock reaches its stamp. */
  private future(at: number): boolean {
    return this.now() - at < 0;
  }

  /** The kept walk while it is fresh, else null; a kept walk whose age reads negative is dropped. */
  keptWalk(): readonly ProjectRow[] | null {
    if (this.walk !== null && this.future(this.walk.at)) this.walk = null;
    return this.walk !== null && this.fresh(this.walk.at) ? this.walk.rows : null;
  }

  /** The stamp a walk or probe takes when it starts, for `keepWalk`/`keepProbe`. */
  stamp(): number {
    return this.now();
  }

  /** Keeps a walk that started at `startedAt`, unless the kept one is still fresh and started later. A kept walk that
   *  is not fresh, a negative age after the clock stepped back included, is replaced whatever the new stamp, as the
   *  probes heal (review 1378, F4). */
  keepWalk(rows: readonly ProjectRow[], startedAt: number): void {
    if (this.walk === null || !this.fresh(this.walk.at) || startedAt > this.walk.at) this.walk = { at: startedAt, rows };
  }

  /** A workdir's kept verdict while it is fresh, else null; a kept verdict whose age reads negative is dropped. */
  keptProbe(workdir: string): boolean | null {
    const v = this.probes.get(workdir);
    if (v !== undefined && this.future(v.at)) { this.probes.delete(workdir); return null; }
    return v !== undefined && this.fresh(v.at) ? v.linked : null;
  }

  /** Keeps a MEASURED verdict from a probe that started at `startedAt`, unless the kept one started later. */
  keepProbe(workdir: string, linked: boolean, startedAt: number): void {
    for (const [k, v] of this.probes) if (!this.fresh(v.at)) this.probes.delete(k);
    const kept = this.probes.get(workdir);
    if (kept === undefined || startedAt > kept.at) this.probes.set(workdir, { at: startedAt, linked });
  }
}

/** `isLinkedWorktree`'s answer, and whether it was MEASURED (review 1375, F2). */
type LinkProbe = 'linked' | 'not-linked' | 'unmeasured';

/** Asks `isLinkedWorktree` itself, unchanged, so D-5967's rule keeps one writer, through a view of `io` whose two reads
 *  go to the measured calls (`readdirMeasured`, `lstatMeasured`) and note any failure that is not a proven absence.
 *  `linked` is exactly `isLinkedWorktree`'s true; otherwise a noted failure answers `unmeasured`, which keeps the row
 *  for this request as `isLinkedWorktree` does, and which `ProjectWalkCache` never keeps. Each read is still one
 *  request. */
const probeLinkedWorktree = async (io: FleetIO, workdir: string, names?: string[] | null): Promise<LinkProbe> => {
  let unmeasured = false;
  const note = (r: { ok: true } | { ok: false; reason: string }): void => { if (!r.ok && r.reason !== 'absent') unmeasured = true; };
  const view = Object.assign(Object.create(io) as FleetIO, {
    readdir: async (p: string): Promise<string[] | null> => {
      const r = await io.readdirMeasured(p);
      note(r);
      return r.ok ? [...r.entries] : null;
    },
    lstatMeasured: async (p: string) => {
      const r = await io.lstatMeasured(p);
      note(r);
      return r;
    },
  });
  if (await isLinkedWorktree(view, workdir, names)) return 'linked';
  return unmeasured ? 'unmeasured' : 'not-linked';
};

/** The root walk: one slot per entry (its listing, then its probe), at most `PROJECT_WALK_CONCURRENCY` in flight, the
 *  answer in the listing's order whatever order the reads finish in. Null when the root itself could not be listed;
 *  `measured` is false when any slot's probe could not answer (its row is kept, the walk is not cached). */
const walkRoot = async (io: FleetIO, cfg: CcrcConfig): Promise<{ rows: ProjectRow[]; measured: boolean } | null> => {
  const names = await io.readdir(cfg.projectsRoot);
  if (names === null) return null;
  let measured = true;
  const rows = await mapBounded(names.filter((n) => !n.startsWith('.')), PROJECT_WALK_CONCURRENCY, async (name) => {
    const workdir = path.join(cfg.projectsRoot, name);
    const entries = await io.readdir(workdir);
    if (entries === null) return null; // not a directory — skip
    const probe = await probeLinkedWorktree(io, workdir, entries);
    if (probe === 'unmeasured') measured = false;
    return probe === 'linked' ? null : { name, workdir };
  });
  return { rows: rows.filter((r): r is ProjectRow => r !== null), measured };
};

/**
 * Directories under cfg.projectsRoot (dotfiles skipped) unioned with registry
 * workdirs, deduped by workdir. Sorted by name (byte order) for determinism.
 * Directory-ness is probed via a second `readdir` (FleetIO carries no file-type
 * info) — it succeeds (possibly empty) for a directory, returns null for a
 * plain file or anything unreadable. A linked worktree cannot masquerade as a
 * project through either door: `isLinkedWorktree` skips it whether it turned
 * up under the projects root or only in the registry.
 *
 * `registry` (spec §2.3; additive on `GET /api/projects`, which spreads this
 * result) says whether the registry half of the union was MEASURED.
 * `'unlistable'` means the registry directory could not be listed, so
 * `projects` holds the root walk alone: a registry-only project is then
 * missing because nothing was read, not because it is gone. A refused row
 * (`RegistryRead.refused`) is never read, so its workdir never joins the union.
 *
 * D-6436: `rows`, when given, IS the registry half (the watcher's current listing, which `fleetRowsUsable` passed),
 * so no session field file is read and the answer is `'listed'`; omitted, this reads the registry itself, exactly as
 * before. The walk and the registry workdirs' probes run through `mapBounded`, and precedence is unchanged whatever
 * order the reads finish in: root rows first, then registry rows in record order, the first holder of a workdir
 * keeping it. `cache`, when given, keeps the walk and the probes' verdicts (`ProjectWalkCache`).
 */
export async function listProjects(
  io: FleetIO,
  cfg: CcrcConfig,
  rows?: readonly ProjectSourceRow[],
  cache?: ProjectWalkCache,
): Promise<{ roots: string[]; projects: ProjectRow[]; registry: 'listed' | 'unlistable' }> {
  let walked = cache?.keptWalk() ?? null;
  if (walked === null) {
    const startedAt = cache?.stamp();
    const fresh = await walkRoot(io, cfg);
    if (fresh !== null && fresh.measured && startedAt !== undefined) cache?.keepWalk(fresh.rows, startedAt);
    walked = fresh?.rows ?? [];
  }
  const byWorkdir = new Map<string, ProjectRow>(walked.map((r) => [r.workdir, r]));
  let source: readonly ProjectSourceRow[];
  let listed: boolean;
  if (rows !== undefined) {
    source = rows;
    listed = true;
  } else {
    // [registry-refused:reports] one read; `registry` below reports whether it listed.
    const reg = await readRegistryMeasured(io, cfg);
    source = reg.listed ? reg.records : [];
    listed = reg.listed;
  }
  // One probe per workdir the root did not already hold, in first-appearance order.
  const candidates = [...new Set(source.map((r) => r.workdir).filter((w) => !byWorkdir.has(w)))];
  const linked = await mapBounded(candidates, PROJECT_WALK_CONCURRENCY, async (workdir) => {
    const kept = cache?.keptProbe(workdir) ?? null;
    if (kept !== null) return kept;
    const startedAt = cache?.stamp();
    const probe = await probeLinkedWorktree(io, workdir);
    if (probe !== 'unmeasured' && startedAt !== undefined) cache?.keepProbe(workdir, probe === 'linked', startedAt);
    return probe === 'linked';   // an unmeasured probe keeps the row, as `isLinkedWorktree` does (D-5967)
  });
  const isLinked = new Map(candidates.map((w, i) => [w, linked[i]!]));
  for (const rec of source) {
    if (!byWorkdir.has(rec.workdir) && isLinked.get(rec.workdir) === false) {
      byWorkdir.set(rec.workdir, { name: rec.project, workdir: rec.workdir });
    }
  }
  const projects = [...byWorkdir.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.workdir < b.workdir ? -1 : 1,
  );
  return { roots: [cfg.projectsRoot], projects, registry: listed ? 'listed' : 'unlistable' };
}
