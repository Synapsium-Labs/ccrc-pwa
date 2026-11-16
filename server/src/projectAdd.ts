/**
 * The decisions of the operator's project add (`POST /api/projects`, add-project spec 2026-11-04 §4), made once and
 * without I/O. L1 policy, C4 Workspace Lifecycle (beside `workspaceCreate.ts`, as ccd's `cmd_project_add` sits in C4):
 * the route (L4) hands `planProjectAdd` the body and the deployed ccd's caps, runs the argv it answers, and asks
 * `classifyProjectAddFailure` what a failed call MEANS. It decides nothing itself.
 *
 * Every refusal is decided here, before any argv exists, so a refused body can never reach ccd. The grammar is
 * `shared/projectAdd.ts`'s, the one the sheet prefills with, so a name the sheet offers is a name this accepts. ccd
 * re-checks the name and the url with its own copy of those rules and is the authority on the box.
 */
import { CCD_ARGV, ccdCan, type CcdArgv } from './ccdargv.js';
import { deriveProjectName, isNewProjectName, parseGithubRepo, type ProjectAddSource } from '../../shared/projectAdd.js';
import type { ProjectAddRefusal } from '../../shared/refusal.js';
import type { NotRan } from './unmeasured.js';

export type ProjectAddPlan =
  | { kind: 'refuse'; error: Extract<ProjectAddRefusal, 'bad-source'> | 'bad-request' | 'bad-project' | 'unsupported' }
  | { kind: 'run'; name: string; source: ProjectAddSource; argv: CcdArgv };

/** The deployed ccd's `ccd caps` list, as `ccdCan` reads it (`Deps.fleetState`; absent is no evidence). */
export type ProjectAddBox = Parameters<typeof ccdCan>[0];

const refuse = (error: Extract<ProjectAddPlan, { kind: 'refuse' }>['error']): ProjectAddPlan => ({ kind: 'refuse', error });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What to do with this body. Order, each step before the next:
 *   1. a body that is not an object, a `source` outside `github`/`empty`, or a field of the wrong type (`repo` not a
 *      string on a clone, `name` not a string where one is required or given) is `400 bad-request`: the sheet never
 *      sends one, so it is a caller's shape error, not something the operator typed;
 *   2. a clone's `repo` that `parseGithubRepo` does not accept is `400 bad-source`;
 *   3. a name, trimmed, that is not `isNewProjectName` is `400 bad-project`. A clone with no name, or a blank one, takes
 *      the repo's own (`deriveProjectName`); a repo name that cannot be a project's is `bad-project` too, cured by naming
 *      it. An empty project's blank name is `bad-project`: there is nothing to derive it from;
 *   4. a box whose measured caps lack `project-add` is `501 unsupported` (`verbRow`: no evidence permits), so an older
 *      ccd is never sent a verb it would answer with a usage error.
 * A `repo` on an empty body is ignored: the source decides which entry is built.
 */
export function planProjectAdd(body: unknown, box: ProjectAddBox): ProjectAddPlan {
  if (!isRecord(body)) return refuse('bad-request');
  const { source, repo, name } = body;
  if (source === 'empty') {
    if (typeof name !== 'string') return refuse('bad-request');
    const n = name.trim();
    if (!isNewProjectName(n)) return refuse('bad-project');
    if (!ccdCan(box, 'projectAddEmpty')) return refuse('unsupported');
    return { kind: 'run', name: n, source, argv: CCD_ARGV.projectAddEmpty(n) };
  }
  if (source !== 'github') return refuse('bad-request');
  if (typeof repo !== 'string' || (name !== undefined && typeof name !== 'string')) return refuse('bad-request');
  const parsed = parseGithubRepo(repo);
  if (parsed === null) return refuse('bad-source');
  const given = name?.trim() ?? '';
  const n = given === '' ? deriveProjectName(parsed) : given;
  if (n === null || !isNewProjectName(n)) return refuse('bad-project');
  if (!ccdCan(box, 'projectAddClone')) return refuse('unsupported');
  return { kind: 'run', name: n, source, argv: CCD_ARGV.projectAddClone(n, parsed.url) };
}

/** `cmd_project_add`'s refusal of a name `$PROJECTS_ROOT` already holds, as a file or a link included. */
const PROJECT_EXISTS = 'project exists: ';

/** What `classifyProjectAddFailure` reads of a failed call (a `CcdResult` is one): ccd's stderr and the `ran` arm, the
 *  not-ran `reason` kept, so a runner that never started ccd stays apart from one whose answer was lost. */
export type ProjectAddFailure = { stderr: string } & ({ ran: true } | Pick<NotRan, 'ran' | 'reason'>);

/**
 * Read a failed call. A not-ran answer (`ran === false`) is NEVER a refusal, whatever its text says: the runner's own
 * stderr is not ccd's verdict (`classifyAddFailure`'s rule). It is `unknown` when the runner may have started ccd — its
 * own wait expired (`timeout`) or the link failed (`transport`) — since ccd may still finish the clone and move it into
 * place; only `spawn` is known never to have run, and is `other`. Of ccd's own answers, everything but the exists
 * sentence is `other`, which the route answers 502 with the stderr, so a failed clone's own words reach the operator.
 */
export function classifyProjectAddFailure(res: ProjectAddFailure): 'exists' | 'unknown' | 'other' {
  if (res.ran === false) return res.reason === 'spawn' ? 'other' : 'unknown';
  return res.stderr.includes(PROJECT_EXISTS) ? 'exists' : 'other';
}
