import path from 'node:path';
import type { CcdArgv } from './ccdargv.js';
import type { CcrcConfig } from './config.js';
import type { Runner } from './exec.js';
import type { FleetIO } from './io.js';
import { readRegistry } from './registry.js';

/** `killed` is REQUIRED here, unlike `ExecResult.killed`: no test anywhere builds
 *  a `CcdResult` literal, and only two whole-object `toEqual`s in
 *  `lifecycle.test.ts` observe it — so requiring it costs nothing and forces
 *  every producer to answer. */
export interface CcdResult { ok: boolean; stdout: string; stderr: string; killed: boolean }

/** Run `ccd <args...>` through the injected Runner; ok = exit code 0. The argv
 *  is a `CcdArgv`, so it can only have been built by `ccdargv.ts` — there is no
 *  other way to obtain a value of that type (task 13S). */
export async function ccd(run: Runner, cfg: CcrcConfig, args: CcdArgv): Promise<CcdResult> {
  const r = await run(cfg.ccdBin, [...args]);
  // `=== true`, not `Boolean(...)`: an ABSENT `killed` (an older agent, the
  // transport catch path, `local` mode) must read as false, and this is the one
  // hop that collapses the optional into the required.
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, killed: r.killed === true };
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
): Promise<{ roots: string[]; projects: { name: string; workdir: string }[] }> {
  const byWorkdir = new Map<string, { name: string; workdir: string }>();
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
