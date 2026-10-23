// ── the release workflows' job boundary (D-6647, D-6648, D-6655, D-6660) ───
//
// A job is the narrowest boundary GitHub enforces against code the install
// runs: the token's permissions and the OIDC request are granted per job, and a
// hosted job is a fresh machine. So every step that runs the install, the
// builder or anything that reads what they produced runs in a job that holds
// read access only, keeps no checkout credential and cannot mint the signing
// identity; and the job that pushes, attests and publishes runs only the
// repository's own scripts, named here byte for byte, and none of the build's
// code. This file holds all three release workflows to that over the PARSED
// YAML (workflowJobs.ts), so a comment can say anything and a key added or
// dropped is still seen. `release-stable.yml` is held too, unsplit (D-6654).
//
// The allowance below is the whole of what a write job may run. A new step in
// one asks for itself here, in the diff, where a reviewer reads it.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_MARKERS, boundaryFindings, isBuildJob, isWriteJob, jobReferences, workflowFile, workflowJobs,
  type WorkflowJob, type WriteAllowance,
} from './workflowJobs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');
const read = (name: string): string => readFileSync(join(WORKFLOWS, name), 'utf8');

/** A called workflow's source: a local `./.github/workflows/<f>.yml` that
 *  exists, and nothing else. */
const readCalled = (uses: string): string | null => {
  const m = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/.exec(uses);
  if (m === null) return null;
  const f = join(WORKFLOWS, m[1]!);
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
};

const RECEIVE = 'bash deploy/release-main.sh receive --in "$RUNNER_TEMP/release-in" --tag "$CCRC_BUILD_TAG" --digest "$CCRC_BUILD_DIGEST" --out release-out';
const VERIFY = 'bash deploy/release-artifact.sh verify --tag "$GITHUB_REF_NAME" --digest "$CCRC_BUILD_DIGEST" --in "$RUNNER_TEMP/release-in" --out release-out';
const PUBLISH_USES = ['actions/checkout', 'actions/download-artifact', 'actions/attest-build-provenance'];
/** release.yml's three moved step bodies (D-3127, D-5548), byte for byte. */
const NAME_BUNDLE = [
  '[ -f "release-out/ccrc-$GITHUB_REF_NAME.tar.gz" ] || { echo "release.yml: the build named its artifact after another release tag at HEAD (this commit carries more than one); refusing to publish $GITHUB_REF_NAME — delete the extra tag, or cut the minor on a commit release-main did not auto-tag" >&2; exit 1; }',
  'cp -- "$CCRC_BUNDLE_PATH" "release-out/ccrc-$GITHUB_REF_NAME.tar.gz.sigstore.json"',
].join('\n');
const WRITE_NOTES = 'node deploy/release-notes.mjs --tag "$GITHUB_REF_NAME" --out "$RUNNER_TEMP/release-notes.txt" || { echo "::warning::release.yml: could not write the release notes for $GITHUB_REF_NAME; publishing with an empty body"; : > "$RUNNER_TEMP/release-notes.txt"; }';
const GH_PUBLISH = 'gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag --prerelease --notes-file "$RUNNER_TEMP/release-notes.txt"';

/** By file, then by write job. */
const ALLOW: Readonly<Record<string, Readonly<Record<string, WriteAllowance>>>> = {
  'release-main.yml': {
    publish: {
      uses: PUBLISH_USES,
      runs: [RECEIVE, 'bash deploy/release-main.sh publish --out release-out'],
      needsIn: ['with.name', 'env.CCRC_BUILD_TAG', 'env.CCRC_BUILD_DIGEST'],
      env: {
        [RECEIVE]: ['CCRC_BUILD_TAG', 'CCRC_BUILD_DIGEST'],
        'bash deploy/release-main.sh publish --out release-out': ['GH_TOKEN', 'CCRC_BUNDLE_PATH'],
      },
    },
  },
  'release.yml': {
    publish: {
      uses: PUBLISH_USES,
      // "Name the provenance bundle" (D-3127), "Write the release notes"
      // (D-5548) and "Publish the GitHub Release", moved unchanged.
      runs: [VERIFY, NAME_BUNDLE, WRITE_NOTES, GH_PUBLISH],
      needsIn: ['env.CCRC_BUILD_DIGEST'],
      env: { [VERIFY]: ['CCRC_BUILD_DIGEST'], [NAME_BUNDLE]: ['CCRC_BUNDLE_PATH'], [WRITE_NOTES]: [], [GH_PUBLISH]: ['GH_TOKEN'] },
    },
  },
  // Its job `if:` reads needs.* as a condition, never as a value.
  'release-stable.yml': {
    promote: {
      uses: ['actions/checkout'],
      runs: ['bash deploy/release-stable.sh'],
      needsIn: [],
      env: { 'bash deploy/release-stable.sh': ['GH_TOKEN'] },
    },
  },
};
const FILES = Object.keys(ALLOW);

const REFERENCE_PHRASES = [
  'which no earlier step of this job declares', 'which is not in its needs', 'does not declare',
  'which this guard cannot read', 'which this guard cannot resolve',
];

const job = (jobs: WorkflowJob[], id: string): WorkflowJob => {
  const j = jobs.find((x) => x.id === id);
  expect(j, `no job ${id}`).toBeDefined();
  return j!;
};
const usesIn = (j: WorkflowJob): string[] => j.steps.flatMap((s) => (s.uses === null ? [] : [s.uses.replace(/@.*$/, '')]));

describe('the release workflows hold the job boundary (D-6647, D-6648, D-6655)', () => {
  it.each(FILES)('W26-G1: %s holds it', (name) => {
    expect(boundaryFindings(read(name), ALLOW[name]!, readCalled)).toEqual([]);
  });

  it.each(['release-main.yml', 'release.yml'])('W26-G2: %s: build is the only build job and publish the only write job', (name) => {
    const jobs = workflowJobs(read(name));
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs.filter(isBuildJob).map((j) => j.id)).toEqual(['build']);
    expect(jobs.filter(isWriteJob).map((j) => j.id)).toEqual(['publish']);
  });

  it('W26-G2: release-stable.yml: full is a build job, promote the only write job, and full\'s verdict is declared by the workflow it calls', () => {
    const wf = workflowFile(read('release-stable.yml'));
    expect(wf.jobs.length).toBeGreaterThanOrEqual(2);
    expect(isBuildJob(job(wf.jobs, 'full'))).toBe(true);
    expect(wf.jobs.filter(isWriteJob).map((j) => j.id)).toEqual(['promote']);
    const full = job(wf.jobs, 'full');
    expect(full.uses).toBe('./.github/workflows/ci.yml');
    const called = readCalled(full.uses!);
    expect(called, 'ci.yml is readable through readCalled').not.toBeNull();
    expect(workflowFile(called!).callOutputs).toContain('verdict');
    expect(jobReferences(job(wf.jobs, 'promote')).some((r) => r.kind === 'needs' && r.id === 'full' && r.output === 'verdict')).toBe(true);
  });

  it.each(['release-main.yml', 'release.yml'])('W26-G3: %s is exactly build then publish, and only publish downloads and attests', (name) => {
    const jobs = workflowJobs(read(name));
    expect(jobs.map((j) => j.id)).toEqual(['build', 'publish']);
    const [build, publish] = jobs as [WorkflowJob, WorkflowJob];
    expect(publish.needs).toEqual(['build']);
    expect(usesIn(publish)).toContain('actions/attest-build-provenance');
    expect(usesIn(publish)).toContain('actions/download-artifact');
    expect(usesIn(build)).not.toContain('actions/attest-build-provenance');
    expect(usesIn(build)).not.toContain('actions/download-artifact');
    expect(usesIn(build)).toContain('actions/upload-artifact');
    expect(usesIn(publish)).not.toContain('actions/upload-artifact');
  });

  it.each(FILES)('W26-G5: %s: every steps and needs reference resolves', (name) => {
    const src = read(name);
    const wf = workflowFile(src);
    let seen = 0;
    for (const j of wf.jobs) {
      for (const r of jobReferences(j)) {
        seen += 1;
        if (r.kind === 'steps') {
          expect(j.steps.slice(0, r.visible).map((s) => s.id), `${name}: job ${j.id} ${r.where} names steps.${r.id}`).toContain(r.id);
          continue;
        }
        expect(j.needs, `${name}: job ${j.id} ${r.where} names needs.${r.id}`).toContain(r.id);
        if (r.output === null) continue;
        const target = job(wf.jobs, r.id);
        const declared = target.uses === null ? Object.keys(target.outputs) : workflowFile(readCalled(target.uses) ?? '{}').callOutputs;
        expect(declared, `${name}: job ${j.id} ${r.where} names needs.${r.id}.outputs.${r.output}`).toContain(r.output);
      }
    }
    expect(seen, `${name}: the scan found too few references`).toBeGreaterThanOrEqual(name === 'release-stable.yml' ? 2 : 3);
    const findings = boundaryFindings(src, ALLOW[name]!, readCalled);
    for (const p of REFERENCE_PHRASES) expect(findings.filter((f) => f.includes(p))).toEqual([]);
  });
});

// ── W26-G4: the planted cases ──────────────────────────────────────────────
// Each is the clean base with ONE change, and each must be seen. They are the
// guard's mutation rows, kept as cases so its teeth are re-proved on every
// run (workflow-yaml-parses.test.ts's pattern).
const BASE = `name: base
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    outputs:
      release: \${{ steps.compare.outputs.release }}
      tag: \${{ steps.compare.outputs.tag }}
      digest: \${{ steps.record.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: prepare
        run: bash deploy/release-main.sh prepare --out o
      - name: compare
        id: compare
        env:
          GH_TOKEN: \${{ github.token }}
        run: bash deploy/release-main.sh compare --out o
      - name: record
        id: record
        if: steps.compare.outputs.release == 'true'
        env:
          CCRC_TAG: \${{ steps.compare.outputs.tag }}
        run: bash deploy/release-artifact.sh record --tag "$CCRC_TAG" --dir o
      - uses: actions/upload-artifact@v4
        if: steps.compare.outputs.release == 'true'
        with:
          name: release-\${{ steps.compare.outputs.tag }}
          path: o/x
  publish:
    needs: build
    if: needs.build.outputs.release == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/download-artifact@v4
        with:
          name: release-\${{ needs.build.outputs.tag }}
          path: \${{ runner.temp }}/release-in
      - name: receive
        env:
          CCRC_BUILD_TAG: \${{ needs.build.outputs.tag }}
          CCRC_BUILD_DIGEST: \${{ needs.build.outputs.digest }}
        run: bash r receive
      - uses: actions/attest-build-provenance@v4
        id: attest
        with:
          subject-path: o/*.tar.gz
      - name: publish
        env:
          GH_TOKEN: \${{ github.token }}
          CCRC_BUNDLE_PATH: \${{ steps.attest.outputs.bundle-path }}
        run: bash r publish
`;
const BASE_ALLOW: Record<string, WriteAllowance> = {
  publish: {
    uses: PUBLISH_USES,
    runs: ['bash r receive', 'bash r publish'],
    needsIn: ['with.name', 'env.CCRC_BUILD_TAG', 'env.CCRC_BUILD_DIGEST'],
    env: { 'bash r receive': ['CCRC_BUILD_TAG', 'CCRC_BUILD_DIGEST'], 'bash r publish': ['GH_TOKEN', 'CCRC_BUNDLE_PATH'] },
  },
};

/** The base with `from` (present exactly once) replaced by `to`. */
const plant = (from: string, to: string): string => {
  const at = BASE.indexOf(from);
  if (at === -1 || BASE.indexOf(from, at + 1) !== -1) throw new Error(`the planted anchor is not in the base exactly once: ${from}`);
  return BASE.slice(0, at) + to + BASE.slice(at + from.length);
};
const BUILD_PERMS = '    permissions:\n      contents: read\n';
const BUILD_PERSIST = '          persist-credentials: false\n';
const RECEIVE_STEP = '      - name: receive\n';
const beforeReceive = (step: string): string => plant(RECEIVE_STEP, `${step}${RECEIVE_STEP}`);
const PUBLISH_CHECKOUT = '      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: actions/download-artifact@v4\n';
const publishCheckoutWith = (line: string): string =>
  plant(PUBLISH_CHECKOUT, `      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n${line}      - uses: actions/download-artifact@v4\n`);
const DOWNLOAD_PATH = '          path: ${{ runner.temp }}/release-in\n';
const PUBLISH_TIMEOUT = '    timeout-minutes: 10\n';
const afterPublishTimeout = (lines: string): string => plant(PUBLISH_TIMEOUT, `${PUBLISH_TIMEOUT}${lines}`);
const RECEIVE_DIGEST = '          CCRC_BUILD_DIGEST: ${{ needs.build.outputs.digest }}\n';
const receiveEnv = (line: string): string => plant(RECEIVE_DIGEST, `${RECEIVE_DIGEST}${line}`);
const beforeJobs = (lines: string): string => plant('jobs:\n', `${lines}jobs:\n`);

const MARKER_RUNS = [
  'cd server && npm ci', 'npm install', 'npm run build', 'npx tsc', 'pnpm i', 'yarn',
  'bash deploy/build-release.sh --out o', 'bash deploy/release-main.sh prepare --out o',
];

const PLANTED: Array<[string, string, string]> = [
  ['the build job holds contents: write', plant(BUILD_PERMS, '    permissions:\n      contents: write\n'), 'runs the install or the build and holds contents: write'],
  ['the build job holds id-token: write', plant(BUILD_PERMS, `${BUILD_PERMS}      id-token: write\n`), 'can mint an OIDC token'],
  ['the build job declares no permissions', plant(BUILD_PERMS, ''), 'declares no permissions of its own'],
  ['the build job holds write-all', plant(BUILD_PERMS, '    permissions: write-all\n'), 'runs the install or the build and holds'],
  ['the build checkout has no persist-credentials', plant(BUILD_PERSIST, ''), 'its checkout keeps its credential'],
  ['the build checkout persists its credential', plant(BUILD_PERSIST, '          persist-credentials: true\n'), 'its checkout keeps its credential'],
  ['a called-workflow job holds contents: write', `${BASE}  called:\n    permissions:\n      contents: write\n    uses: ./.github/workflows/ci.yml\n`, 'holds a write permission and calls a workflow'],
  ...MARKER_RUNS.map((run): [string, string, string] => [`the publish job runs ${run}`, beforeReceive(`      - run: ${run}\n`), 'runs the install or the build and holds']),
  ['the publish job uses setup-node', beforeReceive('      - uses: actions/setup-node@v4\n'), 'holds a write permission and uses'],
  ['the publish job uses the cache', beforeReceive('      - uses: actions/cache@v4\n'), 'holds a write permission and uses'],
  ['the publish job runs a script outside its allowlist', beforeReceive('      - run: node server/scripts/fix-node-pty-helper.mjs\n'), 'outside its allowlist'],
  ['the publish checkout takes a ref from the build', publishCheckoutWith('          ref: ${{ needs.build.outputs.tag }}\n'), 'gives actions/checkout the with: key ref, outside its set'],
  ['the publish checkout takes another repository', publishCheckoutWith('          repository: x/y\n'), 'outside its set'],
  ['the download takes a github-token', plant(DOWNLOAD_PATH, `${DOWNLOAD_PATH}          github-token: x\n`), 'outside its set'],
  ['the publish job carries a job-level env', afterPublishTimeout('    env:\n      BASH_ENV: x\n'), 'carries the job key env'],
  ['the publish job carries defaults', afterPublishTimeout('    defaults:\n      run:\n        shell: bash --rcfile x {0}\n'), 'carries the job key defaults'],
  ['the publish job runs in a container', afterPublishTimeout('    container: node:22\n'), 'carries the job key container'],
  ['the workflow carries env', beforeJobs('env:\n  NODE_OPTIONS: x\n'), 'the workflow carries'],
  ['the workflow carries defaults', beforeJobs('defaults:\n  run:\n    shell: sh\n'), 'the workflow carries'],
  ...['BASH_ENV', 'PATH', 'GIT_CONFIG_GLOBAL', 'LD_PRELOAD'].map((k): [string, string, string] => [`a publish step sets ${k}`, receiveEnv(`          ${k}: x\n`), `sets ${k}`]),
  ['a publish step carries shell', plant(`${RECEIVE_STEP}        env:\n`, `${RECEIVE_STEP}        shell: bash\n        env:\n`), 'carries the key shell'],
  ['a publish step passes a build output under another key', receiveEnv('          OTHER: ${{ needs.build.outputs.tag }}\n'), 'passes a build output into env.'],
  ['the build outputs name a step id nobody declares', plant('${{ steps.record.outputs.digest }}', '${{ steps.recrod.outputs.digest }}'), 'which no earlier step of this job declares'],
  ['the record step has no id', plant('        id: record\n', ''), 'which no earlier step of this job declares'],
  ['a publish env reads an output build does not declare', plant(RECEIVE_DIGEST, '          CCRC_BUILD_DIGEST: ${{ needs.build.outputs.digests }}\n'), 'which job build does not declare'],
  ['a publish env reads a job outside its needs', plant(RECEIVE_DIGEST, '          CCRC_BUILD_DIGEST: ${{ needs.other.outputs.x }}\n'), 'which is not in its needs'],
  ['the workflow grants write-all', beforeJobs('permissions: write-all\n'), 'grants write at workflow level'],
  ['the build job runs self-hosted', plant('    runs-on: ubuntu-latest\n    timeout-minutes: 30\n', '    runs-on: self-hosted\n    timeout-minutes: 30\n'), 'not ubuntu-latest'],
  ['a write job the allowlist does not know', plant('  publish:\n', '  release:\n'), 'is not on the allowlist'],
  // Beyond the plan's list (this task's own guards, each with its mutation row).
  ['the download names no path', plant(DOWNLOAD_PATH, ''), 'gives actions/download-artifact no with: key path, which its set requires'],
  ['the download writes into the checkout', plant(DOWNLOAD_PATH, '          path: release-in\n'), 'not exactly ${{ runner.temp }}/release-in'],
  ['a publish env reads the build output by index', plant(RECEIVE_DIGEST, "          CCRC_BUILD_DIGEST: ${{ needs['build'].outputs.digest }}\n"), 'refers to needs by index, which this guard cannot resolve'],
  ['a publish env passes the whole needs context', receiveEnv('          OTHER: ${{ toJSON(needs) }}\n'), 'passes a build output into env.OTHER'],
  ['a job calls a workflow the guard cannot read', `${BASE}  called:\n    permissions:\n      contents: read\n    uses: octo/elsewhere/.github/workflows/x.yml@v1\n`, 'which this guard cannot read'],
  // D-6663: the write job's step env is an allowlist, build jobs read no
  // secrets, the download path is exact, and action names ignore case.
  ['a publish step sets SHELLOPTS and PS4', receiveEnv("          SHELLOPTS: xtrace\n          PS4: '$(sh $RUNNER_TEMP/release-in/SHA256SUMS)'\n"), 'sets PS4, outside its env set'],
  ['a publish step exports a bash function', receiveEnv("          'BASH_FUNC_git%%': '() { echo; }'\n"), 'sets BASH_FUNC_git%%, outside its env set'],
  ['a publish step moves HOME', receiveEnv('          HOME: ${{ runner.temp }}/release-in\n'), 'sets HOME, outside its env set'],
  ['a called-workflow job inherits secrets', `${BASE}  called:\n    permissions:\n      contents: read\n    uses: ./.github/workflows/ci.yml\n    secrets: inherit\n`, 'runs the install or the build and reads secrets'],
  ['a build step reads a secret', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', '        id: compare\n        env:\n          GH_TOKEN: ${{ secrets.PAT }}\n'), 'runs the install or the build and reads secrets'],
  ['the download path is an expression', plant(DOWNLOAD_PATH, '          path: ${{ runner.temp }}/${{ env.D }}\n        env:\n          D: ../x\n'), 'not exactly ${{ runner.temp }}/release-in'],
  ['a build checkout spelled with a capital keeps its credential', plant('      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n', '      - uses: Actions/checkout@v4\n        with:\n          fetch-depth: 0\n'), 'its checkout keeps its credential'],
  // D-6663, fix round 2: no job reads secrets, by any key or spelling, and
  // context names match without regard to case.
  ['a build job container carries a secret', plant('    timeout-minutes: 30\n', '    timeout-minutes: 30\n    container:\n      image: node:22\n      env:\n        T: ${{ secrets.PAT }}\n'), 'runs the install or the build and reads secrets'],
  ['a build job service carries a secret', plant('    timeout-minutes: 30\n', '    timeout-minutes: 30\n    services:\n      db:\n        image: postgres\n        env:\n          P: ${{ secrets.PAT }}\n'), 'runs the install or the build and reads secrets'],
  ['a build step reads SECRETS in capitals', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', '        id: compare\n        env:\n          GH_TOKEN: ${{ SECRETS.PAT }}\n'), 'runs the install or the build and reads secrets'],
  ['a build step if: reads a secret', plant("        id: record\n        if: steps.compare.outputs.release == 'true'\n", "        id: record\n        if: steps.compare.outputs.release == 'true' && secrets.PAT != ''\n"), 'runs the install or the build and reads secrets'],
  ['the publish step passes a secret under an allowed key', plant('          GH_TOKEN: ${{ github.token }}\n          CCRC_BUNDLE_PATH', '          GH_TOKEN: ${{ secrets.PAT }}\n          CCRC_BUNDLE_PATH'), 'holds a write permission and reads secrets'],
  ['a build step reads the bare secrets context', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', '        id: compare\n        env:\n          GH_TOKEN: ${{ secrets }}\n'), 'runs the install or the build and reads secrets'],
  ['a build step reads secrets through contains()', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', "        id: compare\n        env:\n          GH_TOKEN: ${{ contains(secrets, 'x') }}\n"), 'runs the install or the build and reads secrets'],
  ['a build step reads secrets through toJSON( secrets )', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', '        id: compare\n        env:\n          GH_TOKEN: ${{ toJSON( secrets ) }}\n'), 'runs the install or the build and reads secrets'],
  // Each value is read raw, never as JSON text, so whitespace the
  // expression lexer skips cannot hide the word (D-6663, fix round 3).
  ['a build step reads a secret after a tab', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', '        id: compare\n        env:\n          GH_TOKEN: "${{\\tsecrets.PAT }}"\n'), 'runs the install or the build and reads secrets'],
  ['a build step reads a secret across a block scalar line', plant('        id: compare\n        env:\n          GH_TOKEN: ${{ github.token }}\n', '        id: compare\n        env:\n          GH_TOKEN: |-\n            ${{\n            secrets.PAT }}\n'), 'runs the install or the build and reads secrets'],
  ['the publish step reads a secret after a newline', plant('          GH_TOKEN: ${{ github.token }}\n          CCRC_BUNDLE_PATH', '          GH_TOKEN: "${{\\nsecrets.PAT }}"\n          CCRC_BUNDLE_PATH'), 'holds a write permission and reads secrets'],
  ['a publish step passes NEEDS in capitals under another key', receiveEnv('          OTHER: ${{ NEEDS.build.outputs.tag }}\n'), 'passes a build output into env.OTHER'],
];

describe('W26-G4: the guard sees each planted breach', () => {
  it('the clean base holds', () => {
    expect(boundaryFindings(BASE, BASE_ALLOW, readCalled)).toEqual([]);
  });

  it.each(PLANTED)('%s', (_name, yaml, phrase) => {
    expect(yaml).not.toBe(BASE);
    const findings = boundaryFindings(yaml, BASE_ALLOW, readCalled);
    expect(findings.some((f) => f.includes(phrase)), `no finding contains "${phrase}": ${JSON.stringify(findings)}`).toBe(true);
  });
});

describe('W26-G6: a build job is found by its markers alone (D-6655)', () => {
  const MARKERS = ['npm', 'npx', 'pnpm', 'yarn', 'tsc', 'vite', 'build-release.sh', 'release-main.sh prepare', 'release-main.sh compare'];
  const oneStep = (run: string): WorkflowJob => job(workflowJobs(
    `on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: ${run}\n`,
  ), 'j');

  it.each(MARKERS)('a job running %s is a build job', (marker) => {
    const run = marker.includes('.sh') ? `bash deploy/${marker} --out o` : `${marker} x`;
    expect(isBuildJob(oneStep(run))).toBe(true);
  });

  it('a job whose only step runs bash deploy/release-stable.sh is not', () => {
    expect(isBuildJob(oneStep('bash deploy/release-stable.sh'))).toBe(false);
  });
});
