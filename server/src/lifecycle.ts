import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { Runner } from './exec.js';
import type { FleetIO } from './io.js';
import { readRegistry } from './registry.js';

export interface CcdResult { ok: boolean; stdout: string; stderr: string }

/** Run `ccd <args...>` through the injected Runner; ok = exit code 0. */
export async function ccd(run: Runner, cfg: CcrcConfig, args: string[]): Promise<CcdResult> {
  const r = await run(cfg.ccdBin, args);
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

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
