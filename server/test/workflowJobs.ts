// The release workflows' job boundary, read from the PARSED YAML (D-6655).
//
// GitHub enforces a token's permissions and OIDC access per job, and a hosted
// job is a fresh machine, so the job is the narrowest boundary against code the
// install runs (D-6647). This module classifies every job of a workflow by what
// it runs and what it holds, and reports each place a job crosses that line:
//   - a BUILD job runs the install or the build (one of BUILD_MARKERS) or calls
//     another workflow. It must declare a permissions mapping of `read`/`none`
//     only, no `id-token` key at all, and every checkout in it must set
//     `persist-credentials: false`;
//   - a WRITE job holds any `write`. Its steps may use only the actions its
//     file's allowance names, may run only the exact bodies it names, and may
//     carry nothing else that chooses which code runs: no job-level env,
//     defaults or container, no step shell, no step environment variable
//     outside that step's own allowed set, and a build output only where the
//     allowance says (D-6648, D-6651, D-6663);
//   - a build job, or a job that calls a workflow, carries no `secrets:` key
//     and reads no `secrets` context (D-6663);
//   - every `steps.<id>` and `needs.<job>.outputs.<k>` resolves to an id or an
//     output that is declared, because a missing one is an empty string at run
//     time and no release workflow runs before its merge (D-6659).
// Text pins in build-release.test.ts hold each step's exact shape; this module
// holds the boundary, so a new step in a write job asks for itself in the diff.
import { parse } from 'yaml';

export interface WorkflowStep {
  keys: string[];
  name: string | null;
  id: string | null;
  uses: string | null;
  run: string | null;
  with: Record<string, unknown>;
  env: Record<string, unknown>;
  if: string | null;
}

export interface WorkflowJob {
  id: string;
  keys: string[];
  permissions: unknown;
  needs: string[];
  if: string | null;
  runsOn: unknown;
  uses: string | null;
  with: Record<string, unknown>;
  outputs: Record<string, unknown>;
  env: unknown;
  defaults: unknown;
  steps: WorkflowStep[];
}

export interface WorkflowFile {
  permissions: unknown;
  env: unknown;
  defaults: unknown;
  callOutputs: string[];
  jobs: WorkflowJob[];
}

type Mapping = Record<string, unknown>;
const isMapping = (v: unknown): v is Mapping => v !== null && typeof v === 'object' && !Array.isArray(v);
const mapping = (v: unknown): Mapping => (isMapping(v) ? v : {});
const text = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : String(v));
/** A value as one string, for the reference and build-output scans: a
 *  mapping or a list is scanned as its JSON, never skipped. */
const scanText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '');

function readStep(raw: unknown): WorkflowStep {
  const s = mapping(raw);
  return {
    keys: Object.keys(s),
    name: text(s.name),
    id: text(s.id),
    uses: text(s.uses),
    run: text(s.run),
    with: mapping(s.with),
    env: mapping(s.env),
    if: text(s.if),
  };
}

function readJob(id: string, raw: unknown): WorkflowJob {
  const j = mapping(raw);
  const needs = j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs.map(String) : [String(j.needs)];
  return {
    id,
    keys: Object.keys(j),
    permissions: j.permissions,
    needs,
    if: text(j.if),
    runsOn: j['runs-on'],
    uses: text(j.uses),
    with: mapping(j.with),
    outputs: mapping(j.outputs),
    env: j.env,
    defaults: j.defaults,
    steps: Array.isArray(j.steps) ? j.steps.map(readStep) : [],
  };
}

/** The workflow-level keys this guard reads and the jobs in file order.
 *  Duplicate keys refuse to parse (`uniqueKeys`), so a second `permissions:`
 *  can never hide behind the first. */
export function workflowFile(src: string): WorkflowFile {
  const doc: unknown = parse(src, { uniqueKeys: true });
  if (!isMapping(doc)) throw new Error('the workflow is not a mapping');
  const on = mapping(doc.on);
  return {
    permissions: doc.permissions,
    env: doc.env,
    defaults: doc.defaults,
    callOutputs: Object.keys(mapping(mapping(on.workflow_call).outputs)),
    jobs: Object.entries(mapping(doc.jobs)).map(([id, raw]) => readJob(id, raw)),
  };
}

export function workflowJobs(src: string): WorkflowJob[] {
  return workflowFile(src).jobs;
}

/** D-6655's list: a `run:` body that names one of these runs the install,
 *  the builder or the comparison that reads what the build produced. */
export const BUILD_MARKERS =
  /(?<![\w.-])(?:npm|npx|pnpm|yarn|tsc|vite|build-release\.sh|release-main\.sh\b[^\n]*\b(?:prepare|compare))(?![\w-])/;

export function isBuildJob(job: WorkflowJob): boolean {
  return job.uses !== null || job.steps.some((s) => s.run !== null && BUILD_MARKERS.test(s.run));
}

/** Any `write` grants write; so does any string form but `read-all`, whose
 *  scopes GitHub may widen and which this guard does not try to read. */
function grantsWrite(permissions: unknown): boolean {
  if (permissions === undefined || permissions === null) return false;
  if (typeof permissions === 'string') return permissions !== 'read-all';
  return Object.values(mapping(permissions)).some((v) => v === 'write');
}

export function isWriteJob(job: WorkflowJob): boolean {
  return grantsWrite(job.permissions);
}

export interface WriteAllowance {
  uses: readonly string[];
  runs: readonly string[];
  needsIn: readonly string[];
  /** Each step's allowed `env:` keys, keyed by its exact trimmed run body,
   *  or by its action name for a `uses:` step; a step that is not keyed may
   *  set nothing (D-6663). An allowlist, because the variables that choose
   *  code at a shell's start (`SHELLOPTS` with `PS4`, `BASH_FUNC_*`, `HOME`
   *  and the rest) are not a list anyone finishes. */
  env: Readonly<Record<string, readonly string[]>>;
}

/** The exact `with:` keys a write job may give each allowed action. A
 *  checkout's keys are a subset; the download's and the attest's are the
 *  whole set (EXACT_WITH). So no `ref:`, `repository:` or `path:` on a
 *  checkout, and no `pattern:` or `github-token:` on the download. */
export const WITH_KEYS: Readonly<Record<string, readonly string[]>> = {
  'actions/checkout': ['fetch-depth', 'persist-credentials'],
  'actions/download-artifact': ['name', 'path'],
  'actions/attest-build-provenance': ['subject-path'],
};
const EXACT_WITH = new Set(['actions/download-artifact', 'actions/attest-build-provenance']);

/** The download writes the build's files; at exactly this path, under the
 *  runner's temp directory, they can never land on the checkout's scripts
 *  the next step runs. Exact, because a second expression in the path
 *  (`${{ env.D }}`) is a value this guard cannot read (D-6663). */
const DOWNLOAD_PATH = '${{ runner.temp }}/release-in';

const WRITE_JOB_KEYS = new Set(['runs-on', 'timeout-minutes', 'permissions', 'needs', 'if', 'steps']);
const WRITE_STEP_KEYS = new Set(['name', 'id', 'if', 'uses', 'with', 'env', 'run']);
/** Variables a shell, node, git or the loader reads before the step's own
 *  line runs, so setting one chooses code the allowance never named. A
 *  second check beside the per-step env allowlist (D-6663): one of these is
 *  refused even when an allowance lists it. */
const START_ENV = new Set(['BASH_ENV', 'ENV', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'PATH']);
const setsStartEnv = (key: string): boolean => START_ENV.has(key.toUpperCase()) || /^GIT_/i.test(key);

/** GitHub resolves an action's owner and name without regard to case, so
 *  every comparison is made on the lowercased name (D-6663). */
const actionName = (uses: string): string => uses.replace(/@.*$/, '').toLowerCase();
const shown = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? 'nothing' : JSON.stringify(v));

/** Each `${{ … }}` in a value that reads the `needs` context at all — a
 *  member, an index or the whole of it (`toJSON(needs)`). */
const readsNeeds = (v: unknown): boolean =>
  [...scanText(v).matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((m) => /(?<![\w.-])needs\b/.test(m[1] ?? ''));
/** Any `${{ … }}` in a value that reads the `secrets` context at all. */
const readsSecrets = (v: unknown): boolean =>
  [...scanText(v).matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((m) => /(?<![\w.-])secrets\b/.test(m[1] ?? ''));

export interface JobReference {
  /** `outputs.<k>`, `if`, `env.<K>`, or `step <n> if|with.<k>|env.<K>`. */
  where: string;
  kind: 'steps' | 'needs';
  id: string;
  output: string | null;
  /** For a `steps` reference: how many of the job's steps it may name, in
   *  order — every step for the job's `outputs:`, the earlier ones for a
   *  step's own values. */
  visible: number;
}

/** Every `steps.<id>` and `needs.<j>` a job's `outputs:`, `if:`, `env:` and
 *  its steps' `if:`, `with:` and `env:` values name, by member access. An
 *  index form (`needs['x']`) is not resolvable and is reported apart. */
export function jobReferences(job: WorkflowJob): JobReference[] {
  const out: JobReference[] = [];
  const scan = (where: string, value: unknown, visible: number): void => {
    const s = scanText(value);
    for (const m of s.matchAll(/(?<![\w.-])steps\.([A-Za-z_][\w-]*)(?:\.outputs\.([A-Za-z_][\w-]*))?/g)) {
      out.push({ where, kind: 'steps', id: m[1]!, output: m[2] ?? null, visible });
    }
    for (const m of s.matchAll(/(?<![\w.-])needs\.([A-Za-z_][\w-]*)(?:\.outputs\.([A-Za-z_][\w-]*))?/g)) {
      out.push({ where, kind: 'needs', id: m[1]!, output: m[2] ?? null, visible });
    }
  };
  for (const [k, v] of Object.entries(job.outputs)) scan(`outputs.${k}`, v, job.steps.length);
  if (job.if !== null) scan('if', job.if, 0);
  for (const [k, v] of Object.entries(mapping(job.env))) scan(`env.${k}`, v, 0);
  job.steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (step.if !== null) scan(`${at} if`, step.if, i);
    for (const [k, v] of Object.entries(step.with)) scan(`${at} with.${k}`, v, i);
    for (const [k, v] of Object.entries(step.env)) scan(`${at} env.${k}`, v, i);
  });
  return out;
}

/** The index forms jobReferences cannot follow, wherever it scans. */
function indexedReferences(job: WorkflowJob): string[] {
  const values: unknown[] = [...Object.values(job.outputs), job.if, ...Object.values(mapping(job.env))];
  for (const s of job.steps) values.push(s.if, ...Object.values(s.with), ...Object.values(s.env));
  const found = new Set<string>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    for (const m of scanText(v).matchAll(/(?<![\w.-])(steps|needs)\s*\[/g)) found.add(m[1]!);
  }
  return [...found];
}

const NO_ALLOWANCE: WriteAllowance = { uses: [], runs: [], needsIn: [], env: {} };

/** One plain sentence per breach of the boundary, naming the job; empty when
 *  the file holds. `allow` is this file's allowance, keyed by write job.
 *  `readCalled` returns a called workflow's source, or null. */
export function boundaryFindings(
  src: string,
  allow: Readonly<Record<string, WriteAllowance>>,
  readCalled: (uses: string) => string | null,
): string[] {
  const wf = workflowFile(src);
  const out: string[] = [];
  const writeJobs = wf.jobs.filter(isWriteJob);

  if (grantsWrite(wf.permissions)) out.push(`the workflow grants write at workflow level: permissions ${shown(wf.permissions)}`);
  if (writeJobs.length > 0) {
    if (wf.env !== undefined) out.push('the workflow carries env beside a write job');
    if (wf.defaults !== undefined) out.push('the workflow carries defaults beside a write job');
  }

  const byId = new Map(wf.jobs.map((j) => [j.id, j]));
  const calledOutputs = new Map<string, string[] | null>();
  const outputsOfCalled = (uses: string): string[] | null => {
    if (!calledOutputs.has(uses)) {
      const called = readCalled(uses);
      calledOutputs.set(uses, called === null ? null : workflowFile(called).callOutputs);
    }
    return calledOutputs.get(uses)!;
  };

  for (const job of wf.jobs) {
    const J = `job ${job.id}`;

    // ── classification (D-6655, D-6660) ──
    if (job.permissions === undefined) out.push(`${J} declares no permissions of its own`);
    if (job.uses === null && job.runsOn !== 'ubuntu-latest') out.push(`${J} runs on ${shown(job.runsOn)}, not ubuntu-latest`);
    if (job.uses !== null && outputsOfCalled(job.uses) === null) out.push(`${J} calls ${job.uses}, which this guard cannot read`);

    if (isBuildJob(job)) {
      if (job.permissions !== undefined) {
        if (!isMapping(job.permissions)) {
          out.push(`${J} runs the install or the build and holds permissions: ${shown(job.permissions)}`);
        } else {
          for (const [k, v] of Object.entries(job.permissions)) {
            if (k === 'id-token') out.push(`${J} runs the install or the build and can mint an OIDC token (id-token: ${shown(v)})`);
            else if (v !== 'read' && v !== 'none') out.push(`${J} runs the install or the build and holds ${k}: ${shown(v)}`);
          }
        }
      }
      job.steps.forEach((s, i) => {
        if (s.uses !== null && actionName(s.uses) === 'actions/checkout' && s.with['persist-credentials'] !== false) {
          out.push(`${J} runs the install or the build and its checkout keeps its credential (step ${i + 1})`);
        }
      });
      // isBuildJob holds every called-workflow job, so this covers both.
      const values: unknown[] = [...Object.values(job.with), ...Object.values(mapping(job.env))];
      for (const st of job.steps) values.push(...Object.values(st.with), ...Object.values(st.env), st.run);
      if (job.keys.includes('secrets') || values.some(readsSecrets)) {
        out.push(`${J} runs the install or the build and reads secrets`);
      }
    }

    // ── a write job's steps, and what chooses its code (D-6648, D-6651) ──
    if (isWriteJob(job)) {
      const a = allow[job.id];
      if (a === undefined) out.push(`${J} holds a write permission and is not on the allowlist`);
      const allowance = a ?? NO_ALLOWANCE;
      if (job.uses !== null) out.push(`${J} holds a write permission and calls a workflow: ${job.uses}`);
      for (const k of job.keys) if (!WRITE_JOB_KEYS.has(k)) out.push(`${J} holds a write permission and carries the job key ${k}`);
      job.steps.forEach((s, i) => {
        const n = i + 1;
        for (const k of s.keys) if (!WRITE_STEP_KEYS.has(k)) out.push(`${J} holds a write permission and step ${n} carries the key ${k}`);
        if (s.uses !== null) {
          const name = actionName(s.uses);
          if (!allowance.uses.includes(name)) {
            out.push(`${J} holds a write permission and uses ${s.uses}`);
          } else {
            const keys = WITH_KEYS[name] ?? [];
            for (const k of Object.keys(s.with)) {
              if (!keys.includes(k)) out.push(`${J} gives ${name} the with: key ${k}, outside its set`);
            }
            if (EXACT_WITH.has(name)) {
              for (const k of keys) if (!(k in s.with)) out.push(`${J} gives ${name} no with: key ${k}, which its set requires`);
            }
            if (name === 'actions/download-artifact' && 'path' in s.with && s.with.path !== DOWNLOAD_PATH) {
              out.push(`${J} downloads the build's artifact into ${shown(s.with.path)}, not exactly ${DOWNLOAD_PATH}`);
            }
          }
        }
        if (s.run !== null && !allowance.runs.includes(s.run.trim())) {
          out.push(`${J} holds a write permission and runs a step outside its allowlist: ${s.run.trim().slice(0, 80)}`);
        }
        const stepKey = s.run !== null ? s.run.trim() : s.uses !== null ? actionName(s.uses) : '';
        const envSet = Object.hasOwn(allowance.env, stepKey) ? allowance.env[stepKey]! : [];
        for (const k of Object.keys(s.env)) {
          if (!envSet.includes(k)) out.push(`${J} holds a write permission and step ${n} sets ${k}, outside its env set`);
          if (setsStartEnv(k)) out.push(`${J} holds a write permission and step ${n} sets ${k}, which a shell or a loader reads at start`);
        }
        const places: Array<[string, unknown]> = [
          ...Object.entries(s.with).map(([k, v]): [string, unknown] => [`with.${k}`, v]),
          ...Object.entries(s.env).map(([k, v]): [string, unknown] => [`env.${k}`, v]),
        ];
        for (const [place, v] of places) {
          if (readsNeeds(v) && !allowance.needsIn.includes(place)) out.push(`${J} passes a build output into ${place} of step ${n}`);
        }
      });
    }

    // ── references resolve (D-6655) ──
    for (const ctx of indexedReferences(job)) out.push(`${J} refers to ${ctx} by index, which this guard cannot resolve`);
    for (const r of jobReferences(job)) {
      if (r.kind === 'steps') {
        if (!job.steps.slice(0, r.visible).some((s) => s.id === r.id)) {
          out.push(`${J} refers to steps.${r.id}, which no earlier step of this job declares (${r.where})`);
        }
        continue;
      }
      if (!job.needs.includes(r.id)) {
        out.push(`${J} refers to needs.${r.id}, which is not in its needs (${r.where})`);
        continue;
      }
      if (r.output === null) continue;
      const target = byId.get(r.id);
      let declared: string[] | null;
      if (target === undefined) declared = [];
      else if (target.uses !== null) declared = outputsOfCalled(target.uses);
      else declared = Object.keys(target.outputs);
      // An unreadable called workflow is reported once, on its own job.
      if (declared !== null && !declared.includes(r.output)) {
        out.push(`${J} refers to needs.${r.id}.outputs.${r.output}, which job ${r.id} does not declare (${r.where})`);
      }
    }
  }
  return out;
}
