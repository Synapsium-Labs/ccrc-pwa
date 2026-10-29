// D-7406 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.1 "The mirror", "Ref lifetime"). L3:
// the service's git on its mirrors. The timer fetch names its refspec explicitly, `+refs/heads/*:refs/remotes/origin/*`,
// with `--prune`, so pruning touches only the refs that refspec maps and a running run's `refs/ccrc-test/*` survive
// (a `--mirror` fetch would delete them). A run's refs are deleted only when `runs.ts#retentionPlan` says so, and
// `gc` runs with git's default prune expiry. Every call passes `-c safe.directory=<mirror>`, `GIT_CONFIG_NOSYSTEM=1`
// and an environment built from empty, so no `GIT_DIR`-style variable of the service's can redirect it. The fleet
// agent's entry point imports nothing that reaches this file.
import { SERVICE_PATH, type Exec, type ExecResult } from './exec.js';

export type Git = (args: readonly string[]) => Promise<ExecResult>;

/** The scratch refs' namespace (spec §2.1). */
export const RUN_REF_PREFIX = 'refs/ccrc-test/';
export const MIRROR_FETCH_REFSPEC = '+refs/heads/*:refs/remotes/origin/*';
const RUN_ID = /^[0-9a-f]{32}$/;

/** The git child's whole environment. */
export function gitEnv(home: string): Record<string, string> {
  return { HOME: home, PATH: SERVICE_PATH, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

/** git through the service's exec (`exec.ts`), whose environment is `gitEnv`'s. */
export function realGit(exec: Exec, git = 'git'): Git {
  return (args) => exec(git, args);
}

const at = (mirror: string): string[] => ['-C', mirror, '-c', `safe.directory=${mirror}`];

export interface MirrorOps {
  fetch(mirror: string): Promise<ExecResult>;
  /** The run ids that hold refs in the mirror. */
  runIds(mirror: string): Promise<string[]>;
  /** Every ref under `refs/ccrc-test/<runId>/`, deleted. */
  deleteRefs(mirror: string, runId: string): Promise<void>;
  gc(mirror: string): Promise<ExecResult>;
}

export function mirrorOps(git: Git): MirrorOps {
  const refsOf = async (mirror: string, prefix: string): Promise<string[]> => {
    const r = await git([...at(mirror), 'for-each-ref', '--format=%(refname)', prefix]);
    if (r.status !== 0) throw new Error(`git for-each-ref in ${mirror}: ${r.stderr.trim()}`);
    return r.stdout.split('\n').filter((l) => l !== '');
  };
  return {
    fetch: (mirror) => git([...at(mirror), 'fetch', '--prune', '--quiet', 'origin', MIRROR_FETCH_REFSPEC]),
    async runIds(mirror) {
      const ids = new Set<string>();
      for (const ref of await refsOf(mirror, RUN_REF_PREFIX)) {
        const id = ref.slice(RUN_REF_PREFIX.length).split('/')[0] ?? '';
        if (RUN_ID.test(id)) ids.add(id);
      }
      return [...ids].sort();
    },
    async deleteRefs(mirror, runId) {
      if (!RUN_ID.test(runId)) throw new Error(`not a run id: ${JSON.stringify(runId)}`);
      for (const ref of await refsOf(mirror, `${RUN_REF_PREFIX}${runId}/`)) {
        const r = await git([...at(mirror), 'update-ref', '-d', ref]);
        if (r.status !== 0) throw new Error(`git update-ref -d ${ref}: ${r.stderr.trim()}`);
      }
    },
    gc: (mirror) => git([...at(mirror), 'gc', '--quiet']),
  };
}
