import path from 'node:path';
import type { CcdArgv } from './ccdargv.js';
import type { CcrcConfig } from './config.js';
import { UNMEASURED, type Runner, type Unmeasured } from './exec.js';
import type { FleetIO } from './io.js';
import type { ProjectRow } from '../../shared/api.js';
import { readRegistry } from './registry.js';

/** `killed` and `signal` are REQUIRED here, unlike their `ExecResult`
 *  counterparts: no test anywhere builds a `CcdResult` literal, and only a
 *  handful of whole-object `toEqual`s in `lifecycle.test.ts` observe them — so
 *  requiring them costs nothing and forces every producer to answer.
 *
 *  REQUIRED, so they carry the TOKEN rather than an absence (`exec.ts`'s
 *  vocabulary paragraph). §1.7: `killed: boolean` USED to be the answer and was
 *  wrong in one direction only — `r.killed === true` collapsed an ABSENT
 *  optional into `false`, telling every caller "this child was not killed" when
 *  the truth was "nobody measured whether it was". The adoption gate handles
 *  those two differently on purpose, and an older agent, the transport catch
 *  path and `local` mode all land in the second. */
export interface CcdResult {
  ok: boolean; stdout: string; stderr: string;
  killed: boolean | Unmeasured;
  signal: string | null | Unmeasured;
}

/** Run `ccd <args...>` through the injected Runner; ok = exit code 0. The argv
 *  is a `CcdArgv`, so it can only have been built by `ccdargv.ts` — there is no
 *  other way to obtain a value of that type (task 13S). */
export async function ccd(run: Runner, cfg: CcrcConfig, args: CcdArgv): Promise<CcdResult> {
  const r = await run(cfg.ccdBin, [...args]);
  // The one hop that turns the optional shape into the token shape. `=== undefined`
  // is the whole test: absence — and ONLY absence — becomes `UNMEASURED`. A
  // measured `false` stays `false`, and a measured `null` signal stays `null`.
  return {
    ok: r.code === 0, stdout: r.stdout, stderr: r.stderr,
    killed: r.killed === undefined ? UNMEASURED : r.killed,
    signal: r.signal === undefined ? UNMEASURED : r.signal,
  };
}

/** "THIS CALL'S CHILD WAS CUT SHORT" — the single fact §1.5's adoption gate
 *  rests on, and (wire discipline) the SINGLE READER of `killed` and `signal`,
 *  so the two halves of one measurement are never interpreted twice in two
 *  places that could drift apart.
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
  const signalMeasured = r.signal !== UNMEASURED;
  if (r.killed === true) return true;
  if (signalMeasured && r.signal !== null) return true;
  if (!signalMeasured) return UNMEASURED;
  return false;
}

/** The single ccd capability `Deps` carries in place of a raw `Runner`. */
export type CcdRunner = (argv: CcdArgv) => Promise<CcdResult>;

/** Composition-root factory: binds a `Runner` and a config into the one
 *  capability every downstream module gets. Holding only the result, a route
 *  has no runner to reach and no value of the right type to invent — which is
 *  the property layer 2b used to police by scanning source text. */
export const ccdRunner = (run: Runner, cfg: CcrcConfig): CcdRunner =>
  (argv) => ccd(run, cfg, argv);

/** A linked worktree (or submodule) masquerading as a project: `.git` exists
 *  but is a FILE. readdir-null is the only file-vs-dir probe FleetIO affords —
 *  it succeeds for a directory and answers null for a plain file. A dir with
 *  NO .git at all is a legitimate non-git project (four exist on the fleet)
 *  and must never be skipped; an UNREADABLE workdir stays listed, same as
 *  today — this probe only ever removes what it positively identified.
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
  return (await io.readdir(path.join(workdir, '.git'))) === null;
};

/**
 * Directories under cfg.projectsRoot (dotfiles skipped) unioned with registry
 * workdirs, deduped by workdir. Sorted by name (byte order) for determinism.
 * Directory-ness is probed via a second `readdir` (FleetIO carries no file-type
 * info) — it succeeds (possibly empty) for a directory, returns null for a
 * plain file or anything unreadable. A linked worktree cannot masquerade as a
 * project through either door: `isLinkedWorktree` skips it whether it turned
 * up under the projects root or only in the registry.
 */
export async function listProjects(
  io: FleetIO,
  cfg: CcrcConfig,
): Promise<{ roots: string[]; projects: ProjectRow[] }> {
  const byWorkdir = new Map<string, ProjectRow>();
  const names = await io.readdir(cfg.projectsRoot);
  if (names !== null) {
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const workdir = path.join(cfg.projectsRoot, name);
      const entries = await io.readdir(workdir);
      if (entries === null) continue; // not a directory — skip
      if (await isLinkedWorktree(io, workdir, entries)) continue;
      byWorkdir.set(workdir, { name, workdir });
    }
  }
  for (const rec of await readRegistry(io, cfg)) {
    if (!byWorkdir.has(rec.workdir) && !(await isLinkedWorktree(io, rec.workdir))) {
      byWorkdir.set(rec.workdir, { name: rec.project, workdir: rec.workdir });
    }
  }
  const projects = [...byWorkdir.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.workdir < b.workdir ? -1 : 1,
  );
  return { roots: [cfg.projectsRoot], projects };
}
