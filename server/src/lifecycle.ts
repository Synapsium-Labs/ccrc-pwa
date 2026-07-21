import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { Runner } from './exec.js';
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
 */
export async function listProjects(
  cfg: CcrcConfig,
): Promise<{ roots: string[]; projects: { name: string; workdir: string }[] }> {
  const byWorkdir = new Map<string, { name: string; workdir: string }>();
  try {
    for (const e of await readdir(cfg.projectsRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const workdir = path.join(cfg.projectsRoot, e.name);
      byWorkdir.set(workdir, { name: e.name, workdir });
    }
  } catch {
    // projects root missing/unreadable — fall through to registry-only listing
  }
  for (const rec of await readRegistry(cfg)) {
    if (!byWorkdir.has(rec.workdir)) byWorkdir.set(rec.workdir, { name: rec.project, workdir: rec.workdir });
  }
  const projects = [...byWorkdir.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.workdir < b.workdir ? -1 : 1,
  );
  return { roots: [cfg.projectsRoot], projects };
}
