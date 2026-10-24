// The release workflows' job boundary, read from the PARSED YAML (D-6655).
//
// GitHub enforces a token's permissions and OIDC access per job, and a hosted
// job is a fresh machine, so the job is the narrowest boundary against code the
// install runs (D-6647). This module classifies every job of a workflow by what
// it runs and what it holds, and reports each place a job crosses that line:
//   - a BUILD job runs the install or the build (one of BUILD_MARKERS) or calls
//     another workflow. It must declare a permissions mapping of `read`/`none`
//     only, no `id-token` key at all, and every checkout in it must set
//     `persist-credentials: false`; and it carries no `continue-on-error` and
//     no `strategy`, so its verdict is one job's (D-6727);
//   - a WRITE job holds any `write`. Its steps may use only the actions its
//     file's allowance names, may run only the exact bodies it names, and may
//     carry nothing else that chooses which code runs: no job-level env,
//     defaults or container, no step shell, no step environment variable
//     outside that step's own allowed set, and a build output only where the
//     allowance says (D-6648, D-6651, D-6663), and no step condition but the
//     exact one its allowance names (D-6729); and its download is at a major
//     whose extractor confines every entry, spelled `@vN` (D-6726);
//   - in EVERY job, a job's or a step's `with:` and `env:`, when present, is a
//     mapping: a whole-value expression, a list or a scalar holds keys and
//     values no check here can read (D-6728);
//   - NO job reads a secret: none carries a `secrets:` key, and the whole
//     parsed job, every key at every depth (container and services env, a
//     step's if: and working-directory included), never names the `secrets`
//     context in any case or form. Every token these workflows use is
//     `github.token` (D-6663);
//   - context names (`secrets`, `needs`, `steps`) match without regard to
//     case, as GitHub resolves them (D-6663);
//   - every `steps.<id>` and `needs.<job>.outputs.<k>` that a job's `outputs:`,
//     `if:` or `env:` or a step's `if:`, `with:` or `env:` names resolves to an
//     id or an output that is declared, because a missing one is an empty
//     string at run time and no release workflow runs before its merge
//     (D-6659). A `run:` body is not scanned: the D-5548 row in
//     build-release.test.ts holds every body free of `${{` instead.
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
  /** The step as parsed, every key, for the checks `with` and `env` fold. */
  raw: Record<string, unknown>;
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
  /** The job as parsed, every key, for the scans that read all of it. */
  raw: Record<string, unknown>;
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
/** Every string a value holds, at every depth: each scalar leaf and each
 *  mapping key, RAW. Never the value's JSON text, which writes a tab or a
 *  newline as two characters and so hides a word behind a `\t` or a `\n`
 *  that GitHub's expression lexer skips (D-6663). */
const leaves = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.flatMap(leaves);
  if (typeof v === 'object') return Object.entries(v as Mapping).flatMap(([k, x]) => [k, ...leaves(x)]);
  return [String(v)];
};

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
    raw: s,
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
    raw: j,
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
  /** The one exact `if:` each step may carry, keyed as `env` is; a step that
   *  is not keyed may carry none (D-6729). A condition decides whether the
   *  step runs at all, `always()` past a failed check included. */
  if: Readonly<Record<string, string>>;
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

/** The download writes the build's files at exactly this path, under the
 *  runner's temp directory and outside the checkout (D-6657). Exact, because
 *  a second expression in the path (`${{ env.D }}`) is a value this guard
 *  cannot read (D-6663). The path alone keeps no entry off the checkout's
 *  scripts; the extractor's major does (DOWNLOAD_MAJOR_FLOOR). */
const DOWNLOAD_PATH = '${{ runner.temp }}/release-in';

/** The oldest `actions/download-artifact` major a write job may use (D-6726).
 *  `@v4` to `@v6` bundle unzip-stream 0.3.1, whose only guard strips a
 *  LEADING run of `../`, so a zip entry `x/../../../<f>` lands outside the
 *  download path, beside the write token and OIDC; `@v7` bundles 0.3.4, which
 *  rewrites every `..` segment and so confines every entry under the path,
 *  where verify's exact file set refuses it. Spelled `@v<N>` exactly: a minor
 *  pin or a SHA names code this floor has not read, and an older major reopens
 *  the hole. */
const DOWNLOAD_MAJOR_FLOOR = 7;
/** What a `uses:` names after its first `@`, or '' when it names nothing. */
const actionRef = (uses: string): string => (uses.includes('@') ? uses.slice(uses.indexOf('@') + 1) : '');
const downloadMajorHolds = (uses: string): boolean => {
  const m = /^v([1-9]\d*)$/.exec(actionRef(uses));
  return m !== null && Number(m[1]) >= DOWNLOAD_MAJOR_FLOOR;
};

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
  leaves(v).some((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((m) => /(?<![\w.-])needs\b/i.test(m[1] ?? '')));
/** A value, scanned whole at every depth, that names the `secrets` context
 *  at all: the bare word, in any case, followed by anything (a member, an
 *  index, `${{ secrets }}`, `contains(secrets, …)`, `toJSON( secrets )`).
 *  Not only inside `${{ }}`: an `if:` is an expression without one. Step
 *  names are scanned too; no release workflow spells the word anywhere.
 *  Each leaf and key is tested raw (`leaves`). */
const readsSecrets = (v: unknown): boolean => leaves(v).some((s) => /(?<![\w.-])secrets(?![\w-])/i.test(s));

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
    const s = leaves(value).join('\n');
    for (const m of s.matchAll(/(?<![\w.-])steps\.([A-Za-z_][\w-]*)(?:\.outputs\.([A-Za-z_][\w-]*))?/gi)) {
      out.push({ where, kind: 'steps', id: m[1]!, output: m[2] ?? null, visible });
    }
    for (const m of s.matchAll(/(?<![\w.-])needs\.([A-Za-z_][\w-]*)(?:\.outputs\.([A-Za-z_][\w-]*))?/gi)) {
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
    for (const s of leaves(v)) for (const m of s.matchAll(/(?<![\w.-])(steps|needs)\s*\[/gi)) found.add(m[1]!.toLowerCase());
  }
  return [...found];
}

const NO_ALLOWANCE: WriteAllowance = { uses: [], runs: [], needsIn: [], env: {}, if: {} };

/** The two keys whose value every check reads as a mapping (D-6728). */
const MAPPING_KEYS = ['with', 'env'] as const;
/** The job keys a build job may not carry (D-6727): `continue-on-error`
 *  passes a failed build, and a `strategy` runs it as several jobs. */
const BUILD_JOB_FORBIDDEN_KEYS = ['continue-on-error', 'strategy'] as const;

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
      for (const k of BUILD_JOB_FORBIDDEN_KEYS) if (job.keys.includes(k)) out.push(`${J} runs the install or the build and carries the job key ${k}`);
    }

    // ── with: and env: are mappings, in every job (D-6728) ──
    for (const k of MAPPING_KEYS) {
      if (Object.hasOwn(job.raw, k) && !isMapping(job.raw[k])) out.push(`${J} carries a job-level ${k}: that is not a mapping: ${shown(job.raw[k])}`);
    }
    job.steps.forEach((s, i) => {
      for (const k of MAPPING_KEYS) {
        if (Object.hasOwn(s.raw, k) && !isMapping(s.raw[k])) out.push(`${J} step ${i + 1} carries ${k === 'env' ? 'an' : 'a'} ${k}: that is not a mapping: ${shown(s.raw[k])}`);
      }
    });

    // ── no job reads a secret (D-6663) ──
    if (job.keys.includes('secrets') || readsSecrets(job.raw)) {
      // isBuildJob holds every called-workflow job.
      if (isBuildJob(job)) out.push(`${J} runs the install or the build and reads secrets`);
      if (isWriteJob(job)) out.push(`${J} holds a write permission and reads secrets`);
      if (!isBuildJob(job) && !isWriteJob(job)) out.push(`${J} reads secrets`);
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
            if (name === 'actions/download-artifact' && !downloadMajorHolds(s.uses)) {
              out.push(`${J} uses actions/download-artifact@${actionRef(s.uses)}, not @v${DOWNLOAD_MAJOR_FLOOR} or later`);
            }
          }
        }
        if (s.run !== null && !allowance.runs.includes(s.run.trim())) {
          out.push(`${J} holds a write permission and runs a step outside its allowlist: ${s.run.trim().slice(0, 80)}`);
        }
        const stepKey = s.run !== null ? s.run.trim() : s.uses !== null ? actionName(s.uses) : '';
        if (s.keys.includes('if') && !(Object.hasOwn(allowance.if, stepKey) && allowance.if[stepKey] === s.if)) {
          out.push(`${J} holds a write permission and step ${n} carries if: ${shown(s.if ?? undefined)}, which its allowance does not permit`);
        }
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
