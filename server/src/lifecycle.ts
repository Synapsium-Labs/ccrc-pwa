import path from 'node:path';
import type { CcdArgv } from './ccdargv.js';
import type { CcrcConfig } from './config.js';
import type { Runner } from './exec.js';
import type { FleetIO } from './io.js';
import { readRegistry } from './registry.js';

export interface CcdResult { ok: boolean; stdout: string; stderr: string }

/** Run `ccd <args...>` through the injected Runner; ok = exit code 0. The argv
 *  is a `CcdArgv`, so it can only have been built by `ccdargv.ts` — there is no
 *  other way to obtain a value of that type (task 13S). */
export async function ccd(run: Runner, cfg: CcrcConfig, args: CcdArgv): Promise<CcdResult> {
  const r = await run(cfg.ccdBin, [...args]);
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

/** The single ccd capability `Deps` carries in place of a raw `Runner`. */
export type CcdRunner = (argv: CcdArgv) => Promise<CcdResult>;

/** Composition-root factory: binds a `Runner` and a config into the one
 *  capability every downstream module gets. Holding only the result, a route
 *  has no runner to reach and no value of the right type to invent — which is
 *  the property layer 2b used to police by scanning source text. */
export const ccdRunner = (run: Runner, cfg: CcrcConfig): CcdRunner =>
  (argv) => ccd(run, cfg, argv);

/**
 * Directories under cfg.projectsRoot (dotfiles skipped) unioned with registry
 * workdirs, deduped by workdir. Sorted by name (byte order) for determinism.
 * Directory-ness is probed via a second `readdir` (FleetIO carries no file-type
 * info) — it succeeds (possibly empty) for a directory, returns null for a
 * plain file or anything unreadable.
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
      if ((await io.readdir(workdir)) === null) continue; // not a directory — skip
      byWorkdir.set(workdir, { name, workdir });
    }
  }
  for (const rec of await readRegistry(io, cfg)) {
    if (!byWorkdir.has(rec.workdir)) byWorkdir.set(rec.workdir, { name: rec.project, workdir: rec.workdir });
  }
  const projects = [...byWorkdir.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.workdir < b.workdir ? -1 : 1,
  );
  return { roots: [cfg.projectsRoot], projects };
}
