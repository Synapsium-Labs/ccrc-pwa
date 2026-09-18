# Release channel and fleet rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every merge to `main` becomes a GitHub Release; one verb (`ccrc rollout`) moves both boxes to it in order; `ccrc update` is safe to run twice; and what is running where is visible on the wire, in the PWA, at the CLI and in the doctor.

**Architecture:** A thin `main`-push workflow calls a tested script that tags, builds (via the existing `build-release.sh`) and publishes. `ccd/ccrc` grows `rollout` (ssh-driven `ccrc update` on each box, version pinned first), an `update --check`/`--force` surface and a completed-install record (`~/.ccrc/installed`, written last) that gates a no-op re-run. `FleetHealth` carries both build stamps; the PWA renders them; the doctor gains a `skills` check comparing every home against the shipped tree.

**Tech Stack:** bash (`ccd/ccrc`, `deploy/*.sh`), GitHub Actions, TypeScript (Fastify server, React PWA), vitest. Tests run with `./node_modules/.bin/vitest run <file>` from inside `server/` or `pwa/` — never bare `npx vitest`.

**Spec:** `docs/superpowers/specs/2026-09-18-release-rollout-design.md` — read it first; every task below cites its section.

## Global Constraints

- **Fixture HOMEs only.** Never run `ccrc`/`ccd` against the live `$HOME`; every test uses `mkTmp` + the file's own stub bin (`healthyBox`/`updateEnv`/`healthy()`), as the existing suites do.
- **No hostnames or IPs in tracked text.** Fleet names are roles (the fleet box, the server box); `127.0.0.1` is the one allowed literal (already tracked). The pre-push hook refuses identity residue.
- **Additive wire only.** New `FleetHealth` fields are optional; no `FLEET_PROTO` bump; one reader per field.
- **Mutation-table discipline.** Each guard ships with a case that goes RED when the guard is removed. Measure before/after and record the row in `## Mutation measurements` at the bottom of this plan.
- **README edits are line-neutral.** `pools-prose.test.ts` holds CLAUDE.md's "~3100 lines" claim to ±100; README is 3195 today. Run `wc -l README.md` before and after every README edit; the count must not rise.
- **Deviation numbers are ISSUED**, never chosen: `~/.local/bin/ccrc-api ledger mint --project ccrc-pwa --count N` (or the `POST /api/ledger/deviations` route) — mint per run, define in the same act, never spell a block as a range. A session that cannot reach the allocator writes `D-TBD-<slug>` and says so.
- **Foreground suites, timeout ≥ 600000 ms.** `ccrc-update.test.ts`, `ccrc-install.test.ts` and `ccrc-doctor.test.ts` are slow and load-sensitive; re-run a red in isolation before calling it real.
- **Branch:** work on `spec/release-rollout` (the spec is already there); commit after every task; one PR at the end.
- **`gh` is never stubbed by name in a way that could reach the real binary:** every test that spawns a script which calls `gh` plants a stub at the head of PATH (`build-release.test.ts`'s `plantStubBin` idiom).

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `deploy/release-main.sh` (new) | derive → tag → push → build → publish, with tag cleanup on failure | 1 |
| `server/test/release-main.test.ts` (new) | the script's refusals, derivation, ordering, cleanup | 1 |
| `.github/workflows/release-main.yml` (new) | thin: checkout, node, run the script | 2 |
| `server/test/build-release.test.ts`, `server/test/oss-metadata.test.ts` | pins for the new workflow | 2 |
| `ccd/ccrc` — `_inst_installed`, `_uninst_tree_bins`, `cmd_version` | the completed-install record | 3 |
| `server/test/ccrc-install.test.ts`, `ccrc-uninstall.test.ts`, `ccrc-cli.test.ts` | its pins | 3 |
| `ccd/ccrc` — `cmd_update`, `_upd_resolve`, `_upd_fetch`, `_upd_converged`, usage | `--check`, `--force`, the gate | 4 |
| `server/test/ccrc-update.test.ts` | its pins | 4 |
| `ccd/ccrc` — `cmd_rollout` + helpers, usage, verb table | the one act | 5 |
| `server/test/ccrc-rollout.test.ts` (new) | its pins | 5 |
| `shared/api.ts`, `server/src/server.ts` | `FleetHealth.builds` | 6 |
| `server/test/fleet-health.test.ts`, `fleet-build-skew.test.ts` | its pins | 6 |
| `pwa/src/fleet/useFleetHealth.ts` (new), `BuildLine.tsx` (new), `FleetHostBanner.tsx`, `screens/FleetScreen.tsx`, `fleet.css` | the PWA | 7 |
| `pwa/test/fleet-host-banner.test.tsx`, `pwa/test/build-line.test.tsx` (new) | its pins | 7 |
| `ccd/ccrc-doctor-checks` — `_check_skills`, `_check_fleet` remedy, the table | the doctor | 8 |
| `server/test/ccrc-doctor.test.ts` | its pins | 8 |
| `CLAUDE.md`, `README.md`, the spec (§6 `state` vocabulary) | docs, same PR | 9 |

---

### Task 1: `deploy/release-main.sh` — the tag-build-publish script

**Files:**
- Create: `deploy/release-main.sh`
- Create: `server/test/release-main.test.ts`
- Read for idiom: `deploy/build-release.sh`, `server/test/build-release.test.ts` (`GIT_ENV`, `fixtureRepo`, `plantStubBin`, `runRelease`)

**Interfaces:**
- Consumes: `deploy/build-release.sh --out <dir>` (unchanged); `gh release create <tag> <files…> --verify-tag`.
- Produces: `bash deploy/release-main.sh [--out <dir>]`, exit 0 on publish or on an already-tagged HEAD, 1 on any refusal, 2 on a usage error. Stdout lines start `release-main.sh: `.

- [ ] **Step 1: Write the failing tests**

`server/test/release-main.test.ts`:

```ts
// deploy/release-main.sh — spec §3. On a clean, untagged HEAD: derive the next
// patch tag from the highest existing vX.Y.Z, push it to origin, build with
// build-release.sh, publish with gh — and delete the pushed tag if the publish
// never completes. Fixture: a repo with a BARE origin (so `git push` is real
// and its effect is measurable), the real build-release.sh copied in (its own
// suite proves it), a recording npm that fabricates dists, a recording gh
// whose exit code the test chooses. Never touches the network: curl is
// poisoned, gh is the stub.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-main.sh');
const BUILDER = join(REPO, 'deploy', 'build-release.sh');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** The smallest tree build-release.sh's `git archive` pathspec accepts. */
const FILES: Record<string, string> = {
  'install.sh': '#!/usr/bin/env bash\necho fixture\n',
  'ccd/ccrc': '#!/usr/bin/env bash\necho fixture\n',
  'shared/package.json': '{ "type": "module" }\n',
  'deploy/ccrc.service': '[Unit]\nDescription=fixture\n',
  'server/package.json': '{ "name": "s" }\n', 'server/package-lock.json': '{}\n',
  'agent/package.json': '{ "name": "a" }\n', 'agent/package-lock.json': '{}\n',
  'pwa/package.json': '{ "name": "p" }\n', 'pwa/package-lock.json': '{}\n',
};

/** `<home>/repo` with one commit, `<home>/origin.git` bare and added as
 *  `origin`, optional existing tags (pushed to origin too, as real ones are). */
function fixture(home: string, opts: { tags?: string[]; tagHead?: string } = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(path.dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, { mode: rel.endsWith('.sh') || rel === 'ccd/ccrc' ? 0o755 : 0o644 });
  }
  copyFileSync(BUILDER, join(root, 'deploy', 'build-release.sh'));
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-main.sh'));
  chmodSync(join(root, 'deploy', 'build-release.sh'), 0o755);
  chmodSync(join(root, 'deploy', 'release-main.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  for (const t of opts.tags ?? []) {
    // Each older tag sits on its own earlier commit, so HEAD stays untagged.
    git(root, 'commit', '-q', '--allow-empty', '-m', `release ${t}`);
    git(root, 'tag', t);
  }
  git(root, 'commit', '-q', '--allow-empty', '-m', 'the merge under release');
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  const origin = join(home, 'origin.git');
  spawnSync('git', ['init', '-q', '--bare', origin], { env: { ...process.env, ...GIT_ENV } });
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main', '--tags');
  return root;
}

function plantBin(home: string, ghExit = 0): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$PWD $*" >> "$HOME/npm-argv"',
    'if [ "$1" = "run" ] && [ "$2" = "build" ]; then case "$PWD" in',
    '  */server) mkdir -p dist/server/src; echo "// s" > dist/server/src/index.js ;;',
    '  */pwa) mkdir -p ../server/dist-pwa; echo "<title>p</title>" > ../server/dist-pwa/index.html ;;',
    '  */agent) mkdir -p dist/agent/src; echo "// a" > dist/agent/src/index.js ;;',
    'esac; fi; exit 0',
  ].join('\n'), { mode: 0o755 });
  // gh RECORDS its argv and, at call time, records which tags origin holds —
  // the ordering pin (tag pushed BEFORE publish) reads that record.
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'git -C "$HOME/origin.git" tag > "$HOME/origin-tags-at-gh"',
    `exit ${ghExit}`,
  ].join('\n'), { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "release-main tests never reach the network" >&2\nexit 97\n', { mode: 0o755 });
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [], ghExit = 0): Result {
  const bin = plantBin(home, ghExit);
  const r = spawnSync('bash', [join(root, 'deploy', 'release-main.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const originTags = (home: string): string[] =>
  spawnSync('git', ['-C', join(home, 'origin.git'), 'tag'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l !== '');

describe('release-main.sh: refusals before anything is written', () => {
  it('refuses a dirty tree — no tag, no npm, no gh', () => {
    const home = mkTmp('ccrc-relmain-dirty-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    writeFileSync(join(root, 'straggler.txt'), 'untracked\n');
    const r = run(root, home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing a dirty tree/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('an unknown argument is a usage error, exit 2', () => {
    const home = mkTmp('ccrc-relmain-usage-');
    const root = fixture(home);
    const r = run(root, home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown argument: --bogus/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a HEAD that already carries a vX.Y.Z tag exits 0 and does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const r = run(root, home);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(originTags(home).sort()).toEqual(['v0.0.1', 'v1.0.0']);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
  });
});

describe('release-main.sh: derive, push, build, publish', () => {
  it.each([
    [['v0.0.1'], 'v0.0.2'],
    [['v1.9.9', 'v1.9.10'], 'v1.9.11'],   // sort -V, not lexical: v1.9.10 > v1.9.9
    [['v0.0.1', 'wip', 'backup/x'], 'v0.0.2'],   // non-release tags are ignored
    [[], 'v0.0.1'],
  ])('highest %j → next %s', (tags, next) => {
    const home = mkTmp('ccrc-relmain-derive-');
    const root = fixture(home, { tags });
    const r = run(root, home, ['--out', join(home, 'out')]);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(originTags(home)).toContain(next);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe(next);
    const gh = readFileSync(join(home, 'gh-argv'), 'utf8').trim();
    expect(gh).toBe(`release create ${next} ${join(home, 'out')}/ccrc-${next}.tar.gz ${join(home, 'out')}/SHA256SUMS --verify-tag`);
    // The artifact really is build-release.sh's: the stamp names the tag.
    expect(existsSync(join(home, 'out', `ccrc-${next}.tar.gz`))).toBe(true);
  });

  it('pushes the tag to origin BEFORE publishing — gh --verify-tag needs it there', () => {
    const home = mkTmp('ccrc-relmain-order-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const r = run(root, home, ['--out', join(home, 'out')]);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'origin-tags-at-gh'), 'utf8').split('\n')).toContain('v0.0.2');
  });

  it('a failed publish deletes the pushed tag from origin, so no release-less tag remains', () => {
    const home = mkTmp('ccrc-relmain-cleanup-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const r = run(root, home, ['--out', join(home, 'out')], 1);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
  });
});

describe('release-main.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('derives with sort -V — plain sort would rank v1.9.10 below v1.9.9', () => { expect(src()).toMatch(/sort -V/); });
  it('builds through build-release.sh and owns no second build path', () => {
    expect(src()).toContain('deploy/build-release.sh" --out "$OUT_DIR"');
    expect(src()).not.toMatch(/npm ci|npm run/);
  });
  it('names both artifacts to gh rather than globbing — a glob's order follows the locale', () => {
    expect(src()).toContain('"$OUT_DIR/ccrc-$NEXT.tar.gz" "$OUT_DIR/SHA256SUMS" --verify-tag');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/release-main.test.ts`
Expected: every case FAILS — `deploy/release-main.sh` does not exist (`copyFileSync` throws ENOENT).

- [ ] **Step 3: Write the script**

`deploy/release-main.sh`:

```bash
#!/usr/bin/env bash
# release-main.sh — every merge to main becomes a release (spec §3).
#
# On a clean HEAD that carries no vX.Y.Z tag: derive the next PATCH tag from
# the highest existing release-shaped tag, push it, build the artifact with
# build-release.sh (the one builder — this script adds no second build path),
# and publish it with gh. A HEAD that already carries a release tag is
# release.yml's (a hand-cut minor/major), so this exits 0 having done nothing.
#
# WHY ONE SCRIPT DOES ALL THREE: a tag pushed with the workflow's own
# GITHUB_TOKEN never fires release.yml (GitHub suppresses workflow-caused
# events), and this repo carries no Actions secret that could push as someone
# else. So the main-push job must tag AND build AND publish itself.
#
# THE CLEANUP TRAP: a tag that reached origin while the publish did not is a
# tag `ccrc update --to` can only fail against ("is there a release?"). If
# `gh release create` does not complete, the pushed tag is deleted again and
# a re-run derives the same number.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-main.sh [--out <dir>] — on a clean, untagged HEAD: derive the next vX.Y.Z patch tag, push it, build with build-release.sh, publish with gh"; }
die() { echo "release-main.sh: $*" >&2; exit 1; }

OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --out)
      [ $# -ge 2 ] || { echo "release-main.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    *) echo "release-main.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"

# ── Refusals, before anything is written ─────────────────────────────────
[ -z "$(git -C "$ROOT" status --porcelain)" ] \
  || die "refusing a dirty tree — a release is built from a commit; commit or stash, then re-run (git status --porcelain is non-empty)"

SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'
AT_HEAD="$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" || AT_HEAD=""
if [ -n "$AT_HEAD" ]; then
  echo "release-main.sh: already tagged $AT_HEAD; release.yml owns it — nothing to do"
  exit 0
fi

# ── Derive: highest release-shaped tag, patch + 1 ────────────────────────
# `sort -V` and not `sort`: v1.9.10 outranks v1.9.9, which a lexical sort
# gets backwards. Non-release tags (wip, backup/*, rescue/*) never qualify.
HIGHEST="$(git -C "$ROOT" tag --list 'v*' | grep -E "$SHAPE" | sort -V | tail -n1)" || HIGHEST=""
if [ -n "$HIGHEST" ]; then
  IFS=. read -r MAJOR MINOR PATCH <<< "${HIGHEST#v}"
  NEXT="v$MAJOR.$MINOR.$((PATCH + 1))"
else
  NEXT="v0.0.1"
fi
echo "release-main.sh: highest release tag: ${HIGHEST:-none}; next: $NEXT"

# ── Tag and push, push BEFORE publish (gh --verify-tag checks the remote) ─
git -C "$ROOT" tag "$NEXT" || die "git tag $NEXT failed"
if ! git -C "$ROOT" push origin "refs/tags/$NEXT"; then
  git -C "$ROOT" tag -d "$NEXT" >/dev/null 2>&1 || :
  die "git push origin $NEXT failed — the local tag was removed; nothing was published"
fi

PUBLISHED=false
cleanup() {
  [ "$PUBLISHED" = true ] && return 0
  echo "release-main.sh: the publish did not complete — deleting tag $NEXT from origin so no release-less tag remains" >&2
  git -C "$ROOT" push origin --delete "refs/tags/$NEXT" >/dev/null 2>&1 \
    || echo "release-main.sh: could not delete $NEXT from origin — delete it by hand: git push origin --delete $NEXT" >&2
  git -C "$ROOT" tag -d "$NEXT" >/dev/null 2>&1 || :
}
trap cleanup EXIT

# ── Build (the one builder) and publish ──────────────────────────────────
bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR"
# Both artifacts NAMED, not globbed: a glob's order follows the locale's
# collation (C puts SHA256SUMS first, en_US puts ccrc-… first), and the test
# pins the argv. --verify-tag against origin, as release.yml does.
gh release create "$NEXT" "$OUT_DIR/ccrc-$NEXT.tar.gz" "$OUT_DIR/SHA256SUMS" --verify-tag
PUBLISHED=true
echo "release-main.sh: published $NEXT"
```

Then `chmod 755 deploy/release-main.sh`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/release-main.test.ts`
Expected: all cases PASS. If the `it.each` derivation case for `[]` fails because `git tag --list 'v*'` prints nothing and `grep` exits 1 under `pipefail`: the `|| HIGHEST=""` already covers it; check the assignment line was copied whole.

- [ ] **Step 5: Mutation measurements (record in the table at the bottom)**

Apply each mutation to a COPY of the script under the fixture (the test copies `SCRIPT` — point `SCRIPT` at the mutant temporarily, or edit and revert with `git checkout -- deploy/release-main.sh`), run the suite, record RED/GREEN, restore:
1. delete the `git status --porcelain` refusal → the dirty-tree case must go RED;
2. delete the `AT_HEAD` short-circuit → the tagged-HEAD case RED;
3. replace `sort -V` with `sort` → the `v1.9.11` derivation case RED;
4. swap the `git push` and the `gh release create` lines (move the push below the build) → the ordering case RED;
5. delete the `trap cleanup EXIT` line → the cleanup case RED.

- [ ] **Step 6: Commit**

```bash
git add deploy/release-main.sh server/test/release-main.test.ts
git commit -m "feat(release): release-main.sh — derive the next patch tag, push, build, publish; delete the tag if the publish never completes"
```

---

### Task 2: `.github/workflows/release-main.yml` and its pins

**Files:**
- Create: `.github/workflows/release-main.yml`
- Modify: `server/test/build-release.test.ts` (new `describe` beside `release.yml: the thin workflow`)
- Modify: `server/test/oss-metadata.test.ts` (the two `for (const f of […])` workflow lists gain the new file)

**Interfaces:**
- Consumes: `bash deploy/release-main.sh --out release-out` (Task 1).
- Produces: a GitHub Release per `main` push, named `vX.Y.Z`.

- [ ] **Step 1: Write the failing pins**

Append to `server/test/build-release.test.ts`, after the `release.yml: the thin workflow` describe:

```ts
describe('release-main.yml: the thin main-push workflow, pinned to its script (spec §3)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-main.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on main pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    branches: \[main\]$/m);
    for (const trigger of ['tags:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release-main.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('serialises: one concurrency group, never cancelling an in-flight release', () => {
    const src = wf();
    expect(src).toMatch(/^concurrency:\n  group: release-main\n  cancel-in-progress: false$/m);
  });

  it('asks for contents: write and nothing else', () => {
    const src = wf();
    expect(src).toMatch(/^    permissions:\n      contents: write$/m);
    expect(src).not.toMatch(/(id-token|packages|pull-requests|actions):/);
  });

  it('checks out at full depth — the tags it derives from must be present', () => {
    expect(wf()).toMatch(/fetch-depth: 0/);
  });

  it('invokes release-main.sh and owns no second build or publish path', () => {
    const src = wf();
    expect(src).toContain('bash deploy/release-main.sh --out release-out');
    expect(src, 'the YAML must not build').not.toMatch(/npm ci|npm run|build-release\.sh/);
    expect(src, 'the YAML must not publish — the script owns the publish and its cleanup').not.toMatch(/gh release/);
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
  });
});
```

In `server/test/oss-metadata.test.ts`, change BOTH occurrences of

```ts
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
```

to

```ts
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/release-main.yml']) {
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/build-release.test.ts test/oss-metadata.test.ts`
Expected: the five new cases and the two oss-metadata loops FAIL with ENOENT on `release-main.yml`.

- [ ] **Step 3: Write the workflow**

`.github/workflows/release-main.yml`:

```yaml
# Every merge to main becomes a release (spec 2026-09-18 §3). Thin by design,
# like release.yml: deploy/release-main.sh owns the derivation, the tag push,
# the build and the publish, and is tested locally (server/test/release-main
# .test.ts). No logic lives here that the script does not own — pinned in
# server/test/build-release.test.ts.
#
# Deliberately NOT gated on ci.yml: the PR's required checks are the gate,
# before the merge; main's post-merge matrix is a 45-minute re-check that the
# previous deploy path never waited for either (spec §2, decision 4).
name: release-main

on:
  push:
    branches: [main]

# Two close merges serialise, so the second derives its tag after the first
# has pushed. Never cancel: a cancelled run mid-publish is the release-less
# tag the script's trap exists to prevent.
concurrency:
  group: release-main
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    # The job holds an open contents:write token while it runs. 30, like
    # release.yml — the one measured run took 41 s.
    timeout-minutes: 30
    # Just enough for the tag push and the release the script creates;
    # everything else stays read-only. ci.yml's stated stance is that a
    # writing job asks for it in the diff — this is that ask.
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          # The next tag is derived from the highest existing one, and the
          # release script names the artifact by `git tag --points-at HEAD`:
          # both need the tags present, not a shallow single-commit fetch.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version-file: server/package.json
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json

      # The script owns everything after checkout: refuses dirty/tagged,
      # derives, pushes the tag, builds, publishes, cleans up on failure.
      - name: Tag, build and publish the release
        env:
          GH_TOKEN: ${{ github.token }}
        run: bash deploy/release-main.sh --out release-out
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/build-release.test.ts test/oss-metadata.test.ts`
Expected: PASS, including the existing `release.yml` pins (untouched).

- [ ] **Step 5: Mutation measurements**

1. add `    tags: ['v*']` under `push:` → the trigger pin RED; 2. add a step `run: npm ci` → the second-build-path pin RED; 3. delete the `concurrency:` block → RED; 4. change `timeout-minutes: 30` to `360` → `oss-metadata`'s deadline pin RED. Record; restore.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-main.yml server/test/build-release.test.ts server/test/oss-metadata.test.ts
git commit -m "ci(release): release-main.yml — every push to main runs release-main.sh; pinned thin"
```

---

### Task 3: The completed-install record — `~/.ccrc/installed`, written last

**Files:**
- Modify: `ccd/ccrc` — a `BOX_INSTALLED_FILE` declaration beside `BOX_STAMP_FILE`; new `_inst_installed` called last in `cmd_install`'s spine (after `_inst_wrappers`); `_uninst_tree_bins` removes the file; `cmd_version` prints an `install:` line.
- Modify: `server/test/ccrc-install.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/ccrc-cli.test.ts`.

**Interfaces:**
- Produces: `BOX_INSTALLED_FILE="$HOME/.ccrc/installed"` — one line, the sha of the stamp the spine completed under. Task 4's gate and `--check` read it; Task 5's `rollout` reads `--check`'s `incomplete` state.

- [ ] **Step 1: Write the failing tests**

In `server/test/ccrc-install.test.ts`, inside the describe that holds the `install: done — every step above converged` case (grep `every step above converged`; the surrounding describe is the full-spine one), add:

```ts
  it('writes ~/.ccrc/installed LAST, naming the stamped sha — and a spine that dies before its end leaves none', () => {
    // The completed-install record (spec §5). It cannot ride in build.json:
    // `_inst_stamp` sits mid-spine because the server restarted by
    // `_inst_enable` reads the stamp at boot, so a stamp-only signal would
    // read "installed" on a box whose skills never landed.
    const home = freshBox('ccrc-install-installed-');
    const sha = gitInit(treeRoot(home));
    const ok = runInstall(home);
    expect(ok.code, ok.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\n`);
    expect(ok.stdout).toMatch(/^install: installed: [0-9a-f]{40} \(the spine completed/m);
    // Ordering: the line is printed AFTER the wrappers step's own line.
    const lines = ok.stdout.split('\n');
    expect(lines.findIndex((l) => l.startsWith('install: installed:')))
      .toBeGreaterThan(lines.findIndex((l) => l.startsWith('install: wrappers:')));

    // A fault INSIDE the spine, after the stamp: the reviewer skill's
    // installer refuses when its SKILL.md is missing, which kills
    // `_inst_skills` — the exact shape of the 2026-09-17 incident.
    const broken = freshBox('ccrc-install-installed-fault-');
    gitInit(treeRoot(broken));
    rmSync(treeFile(broken, 'ccd/reviewer-skill/SKILL.md'));
    const r = runInstall(broken);
    expect(r.code).toBe(1);
    expect(existsSync(join(broken, '.ccrc', 'build.json')), 'the stamp is written mid-spine, as designed').toBe(true);
    expect(existsSync(join(broken, '.ccrc', 'installed')), 'a spine that died must leave NO completed-install record').toBe(false);
  });
```

(`rmSync` joins the `node:fs` import; `gitInit`, `treeRoot`, `treeFile`, `freshBox`, `runInstall` already exist in that file.)

In `server/test/ccrc-uninstall.test.ts`, in `plantInstalledBox`'s `~/.ccrc` block (after the `build.json` write) add:

```ts
  writeFileSync(join(home, '.ccrc', 'installed'), 'fixturesha000000000000000000000000000000\n');
```

and in the plain-uninstall case that asserts "The preserve set, whole." add, before the `accounts.json` line:

```ts
    // The completed-install record is NOT config: a box with no tree has no
    // completed install, and leaving it would let a later `ccrc update` skip.
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
```

In `server/test/ccrc-cli.test.ts`, in `describe('ccrc: version'`, add:

```ts
  it('reports install: complete iff ~/.ccrc/installed names the stamped sha', () => {
    const home = mkTmp('ccrc-cli-version-installed-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const stamp = (sha: string): void => writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha, ref: 'main', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.2' }));
    stamp('abc123');
    // No record at all: deploy.sh never writes one.
    expect(runCcrc(home, ['version'])).toMatch(/^install: incomplete — stamp abc123, no completed-install record/m);
    writeFileSync(join(home, '.ccrc', 'installed'), 'abc123\n');
    expect(runCcrc(home, ['version'])).toMatch(/^install: complete$/m);
    // A record from an OLDER completed install under a newer stamp.
    stamp('def456');
    expect(runCcrc(home, ['version'])).toMatch(/^install: incomplete — stamp def456, completed-install record names abc123$/m);
    // Unstamped boxes say nothing about installs (the stamp line already says unstamped).
    rmSync(join(home, '.ccrc', 'build.json'));
    expect(runCcrc(home, ['version'])).not.toMatch(/install:/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run (each in the foreground, timeout ≥ 600000):
`cd server && ./node_modules/.bin/vitest run test/ccrc-cli.test.ts -t "install: complete"`
`cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts`
`cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "writes ~/.ccrc/installed"`
Expected: FAIL — no `install:` line, the marker survives uninstall, no marker is written.

- [ ] **Step 3: Implement**

In `ccd/ccrc`, directly under `BOX_STAMP_FILE="$HOME/.ccrc/build.json"`:

```bash
# The completed-install record (release/rollout design §5): one line, the
# sha of the stamp the install spine COMPLETED under. Written by
# `_inst_installed`, the LAST step of `cmd_install`, so it exists only when
# every step before it did. `build.json` cannot carry this — `_inst_stamp`
# sits mid-spine because the server `_inst_enable` restarts reads the stamp
# at boot — and a stamp that means both "installed" and "half-installed" is
# the overloaded value this tree bans at a seam. deploy.sh never writes it.
BOX_INSTALLED_FILE="$HOME/.ccrc/installed"
```

New function beside `_inst_wrappers`:

```bash
# ── _inst_installed — the completed-install record, the spine's LAST write ─
# Not degraded when the box has no readable stamp (a git-less checkout):
# `ccrc version` already explains "unstamped", and a record naming no sha
# would let update's gate skip a box it cannot identify.
_inst_installed() {
  local rc=0 tmp dest="$BOX_INSTALLED_FILE"
  _box_build_fields || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "install: installed: not recorded — this box has no readable build stamp (ccrc version explains), so 'ccrc update' will never treat it as already installed"
    return 0
  fi
  tmp="$dest.tmp.$$"
  printf '%s\n' "${BOX_BUILD[0]}" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$dest" \
    || { rm -f "$tmp"; _ccrc_die "writing $dest failed"; }
  echo "install: installed: ${BOX_BUILD[0]} (the spine completed under this stamp; ccrc update --check reads it)"
}
```

In `cmd_install`, after the line `  _inst_wrappers` add `  _inst_installed`.

In `_uninst_tree_bins`, after the `rm -rf -- "$BOX_TREE_DIR"` statement:

```bash
  rm -f -- "$BOX_INSTALLED_FILE" \
    || _ccrc_die "removing $BOX_INSTALLED_FILE failed"
```

and append `; the completed-install record removed` to that function's `uninstall: tree:` echo, before the closing quote.

In `cmd_version`, after the `if [[ -n "${BOX_BUILD[4]}" ]]; then … fi` block:

```bash
  local rec=""
  if [[ -f "$BOX_INSTALLED_FILE" ]]; then
    IFS= read -r rec < "$BOX_INSTALLED_FILE" || rec=""
    if [[ "$rec" == "${BOX_BUILD[0]}" ]]; then
      echo "install: complete"
    else
      echo "install: incomplete — stamp ${BOX_BUILD[0]}, completed-install record names ${rec:-nothing}"
    fi
  else
    echo "install: incomplete — stamp ${BOX_BUILD[0]}, no completed-install record (ccrc install and ccrc update write one last; deploy.sh never does)"
  fi
```

- [ ] **Step 4: Run to verify they pass**

The three commands from Step 2. Expected: PASS. Then the whole `ccrc-install.test.ts` and `ccrc-uninstall.test.ts` files, foreground — the fixture gained a file and every "preserve set"/"strays" assertion must still hold.

- [ ] **Step 5: Mutation measurements**

1. move `_inst_installed` above `_inst_skills` in the spine → the fault half of the install case RED (a record exists after the skills step died); 2. delete the `rm -f -- "$BOX_INSTALLED_FILE"` line → the uninstall case RED; 3. in `cmd_version`, compare `"$rec" == "$rec"` → the `def456` sub-case RED.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-install.test.ts server/test/ccrc-uninstall.test.ts server/test/ccrc-cli.test.ts
git commit -m "feat(ccrc): the completed-install record — ~/.ccrc/installed written last by the spine, removed by uninstall, reported by version"
```

---

### Task 4: `ccrc update` — `--check`, `--force`, and the "already there" gate

**Files:**
- Modify: `ccd/ccrc` — `UPD_URL_DIR`/`UPD_TARNAME` file-scope declarations beside `UPD_STAGE`; `_upd_fetch` split into `_upd_resolve` + `_upd_fetch`; new `_upd_converged`; `cmd_update` gains `--check`/`--force` and the gate; `usage()`'s `update` entry.
- Modify: `server/test/ccrc-update.test.ts`.

**Interfaces:**
- Consumes: `BOX_INSTALLED_FILE` (Task 3), `_box_build_fields [stamp-path]` (sets `BOX_BUILD[0..4]` = sha, ref, builtAt, dirty, version).
- Produces: `ccrc update --check [--to vX.Y.Z]` — first stdout line `check: box=<version|unversioned> sha=<sha|none> target=<version> state=<current|behind|unversioned|incomplete>`; exit 0 only for `current`. `ccrc update [--to] [--force]` — prints `update: this box already runs … — nothing to do` and exits 0 when converged. Task 5 parses the `check:` line.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccrc-update.test.ts` (uses that file's `freshUpdateBox`, `plantOldBox`, `plantCoordDb`, `packRelease`, `stubTree`, `fullTree`, `runUpdate`, `localUrls`, `treeDigest`):

```ts
describe('ccrc update --check: what runs here vs what is published (spec §6)', () => {
  const firstLine = (s: string): string => s.split('\n')[0] ?? '';
  const parse = (s: string): Record<string, string> =>
    Object.fromEntries(firstLine(s).replace(/^check: /, '').split(' ').map((kv) => kv.split('=') as [string, string]));

  it('behind: an older version on the box, exit 1, SHA256SUMS fetched and nothing else, nothing written', () => {
    const home = freshUpdateBox('ccrc-update-check-behind-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'v1.0.0', sha: 'oldsha0000000000000000000000000000000000', target: 'v2.0.0', state: 'behind' });
    expect(r.stdout).toMatch(/^this box: v1\.0\.0 \(oldsha[0-9a-f]*\) · latest: v2\.0\.0 — behind$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('current: same version AND the completed-install record names the stamped sha, exit 0', () => {
    const home = freshUpdateBox('ccrc-update-check-current-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(0);
    expect(parse(r.stdout).state).toBe('current');
    expect(r.stdout).toMatch(/— current$/m);
  });

  it('incomplete: same version but no (or a stale) completed-install record, exit 1 — rollout must not skip it', () => {
    const home = freshUpdateBox('ccrc-update-check-incomplete-');
    plantOldBox(home, { version: 'v2.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout).state).toBe('incomplete');
    writeFileSync(join(home, '.ccrc', 'installed'), 'stalesha00000000000000000000000000000000\n');
    r = runUpdate(home, ['--check']);
    expect(parse(r.stdout).state).toBe('incomplete');
  });

  it('unversioned: a deploy.sh stamp (no version), exit 1, and --to labels the target', () => {
    const home = freshUpdateBox('ccrc-update-check-unversioned-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"deploysha0000000000000000000000000000000","ref":"HEAD","builtAt":"2026-09-17T17:16:09Z","dirty":false}\n');
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v1.0.0']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'unversioned', sha: 'deploysha0000000000000000000000000000000', target: 'v1.0.0', state: 'unversioned' });
    expect(r.stdout).toMatch(/^this box: unversioned \(deploysha[0-9a-f]*\) · target: v1\.0\.0 — a release install would be the first on this box$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
  });

  it('unstamped: no build.json at all reads as unversioned with sha=none', () => {
    const home = freshUpdateBox('ccrc-update-check-unstamped-');
    plantOldBox(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toMatchObject({ box: 'unversioned', sha: 'none', state: 'unversioned' });
  });
});

describe('ccrc update: the "already there" gate (spec §5)', () => {
  const converged = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v2.0.0' });
    plantCoordDb(home);
    // The stub release's stamp sha is what stubTree writes: newsha…; the box
    // must carry the SAME sha for the gate's second comparison to hold.
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    return home;
  };

  it('three matching shas → nothing to do: exit 0, tarball verified, NO backup, NO install, NO sweep', () => {
    const home = converged('ccrc-update-gate-skip-');
    writeFileSync(join(home, 'fixture-sweep-units'), 'claude-session@x.service loaded active running\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^update: this box already runs v2\.0\.0 \(newsha[0-9a-f]*\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    // Both fetches happened (the gate's exact stage reads the staged stamp)…
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
    ]);
    // …and nothing after them.
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    const calls = existsSync(join(home, 'systemctl-calls')) ? readFileSync(join(home, 'systemctl-calls'), 'utf8') : '';
    expect(calls).not.toMatch(/try-restart|restart/);
  });

  it('--force skips the gate: the same box installs and sweeps', () => {
    const home = converged('ccrc-update-gate-force-');
    const r = runUpdate(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, record absent → proceeds', () => {
    const home = converged('ccrc-update-gate-norecord-');
    rmSync(join(home, '.ccrc', 'installed'));
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, record names an older sha → proceeds', () => {
    const home = converged('ccrc-update-gate-stale-');
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, the RELEASE carries a different sha (a moved tag) → proceeds', () => {
    const home = converged('ccrc-update-gate-moved-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"boxsha00000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'boxsha00000000000000000000000000000000000\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('a different version never consults the record', () => {
    const home = converged('ccrc-update-gate-differs-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v1.0.0"}\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });
});
```

Add `rmSync` to the file's `node:fs` import.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "check|already there"`
Expected: FAIL — `--check`/`--force` are unknown arguments (exit 2); the gate case installs.

- [ ] **Step 3: Implement**

Beside `UPD_VERSION=""` (file scope) add:

```bash
UPD_URL_DIR=""    # _upd_resolve: the release's URL space (latest/ or download/<tag>/)
UPD_TARNAME=""    # _upd_resolve: the tarball SHA256SUMS names
```

Replace `_upd_fetch` with two functions. `_upd_resolve` is the current function's first half, through `UPD_VERSION="${UPD_VERSION%.tar.gz}"`, with `url_dir`→`UPD_URL_DIR` and `tarname`→`UPD_TARNAME` (both no longer `local`), keeping the `mktemp`, the `trap`, and every die message verbatim. `_upd_fetch` takes no argument and is the second half — from `echo "update: fetching $UPD_URL_DIR/$UPD_TARNAME …"` through `echo "update: verified …"` — reading `UPD_URL_DIR`/`UPD_TARNAME`. Header comment for the split:

```bash
# ── _upd_resolve / _upd_fetch — SHA256SUMS first, then the tarball ────────
# Split (release/rollout design §5-6) so `--check` and `rollout` can learn
# WHICH version is published from the sums file alone — one small download,
# nothing staged beyond it — while the full verb goes on to fetch, verify
# twice and extract exactly as before.
```

New function after `_upd_fetch`:

```bash
# ── _upd_converged — 0 iff stamp sha == staged sha == the completed record ─
# Three comparisons, none dropped: version equality alone is a moved tag
# away from wrong; stamp==staged alone is a half-installed box away from
# wrong (the record is the spine's LAST write, Task 3). An unreadable stamp
# or record is no evidence, so it answers 1 and the update proceeds.
_upd_converged() {
  local rec="" staged=""
  local -a box=()
  _box_build_fields || return 1
  [ -n "${BOX_BUILD[4]}" ] && [ "${BOX_BUILD[4]}" = "$UPD_VERSION" ] || return 1
  box=("${BOX_BUILD[@]}")
  _box_build_fields "$UPD_TREE/build.json" || { BOX_BUILD=("${box[@]}"); return 1; }
  staged="${BOX_BUILD[0]}"
  BOX_BUILD=("${box[@]}")
  [ "$staged" = "${box[0]}" ] || return 1
  [ -f "$BOX_INSTALLED_FILE" ] || return 1
  IFS= read -r rec < "$BOX_INSTALLED_FILE" || return 1
  [ "$rec" = "${box[0]}" ]
}
```

In `cmd_update`: the argument loop gains

```bash
      --check) check=1 ;;
      --force) force=1 ;;
```

with `local to="" check=0 force=0`. After the `--to` shape check and BEFORE the tool probe, the check arm (it needs only `curl`, and `jq` through `_box_build_fields`):

```bash
  if [ "$check" -eq 1 ]; then
    command -v curl >/dev/null 2>&1 || _ccrc_die "curl is required by 'ccrc update --check' but is not on PATH"
    local sha="none" box="unversioned" state="unversioned" label="latest" rec="" rc=0
    [ -n "$to" ] && label="target"
    _box_build_fields || rc=$?
    if [ "$rc" -eq 0 ]; then
      sha="${BOX_BUILD[0]}"
      if [ -n "${BOX_BUILD[4]}" ]; then
        box="${BOX_BUILD[4]}"; state="behind"
      fi
    fi
    _upd_resolve "$to" >/dev/null  # RULING R1: keep `check: …` as the first stdout line for the parser
    if [ "$state" = behind ] && [ "$box" = "$UPD_VERSION" ]; then
      state="incomplete"
      if [ -f "$BOX_INSTALLED_FILE" ] && IFS= read -r rec < "$BOX_INSTALLED_FILE" && [ "$rec" = "$sha" ]; then
        state="current"
      fi
    fi
    # Fixed-shape first line for `ccrc rollout` to parse; the sentence follows.
    echo "check: box=$box sha=$sha target=$UPD_VERSION state=$state"
    case "$state" in
      current)    echo "this box: $box ($sha) · $label: $UPD_VERSION — current"; return 0 ;;
      incomplete) echo "this box: $box ($sha) · $label: $UPD_VERSION — same version, but the install never completed (ccrc version explains); update will reinstall"; return 1 ;;
      behind)     echo "this box: $box ($sha) · $label: $UPD_VERSION — behind"; return 1 ;;
      *)          echo "this box: unversioned ($sha) · $label: $UPD_VERSION — a release install would be the first on this box"; return 1 ;;
    esac
  fi
```

Then replace the three lines `_upd_fleet_warn` / `_upd_fetch "$to"` / `_upd_backup` with:

```bash
  _upd_fleet_warn
  _upd_resolve "$to"
  _upd_fetch
  # THE GATE (design §5): the no-op path costs one verified download and no
  # write — no backup, no restart, no sweep. Two operators told to ship the
  # same release no longer restart the fleet twice.
  if [ "$force" -eq 0 ] && _upd_converged; then
    echo "update: this box already runs $UPD_VERSION (${BOX_BUILD[0]}) and that install completed — nothing to do (pass --force to reinstall)"
    return 0
  fi
  _upd_backup
```

`usage()`'s `update` entry: replace its last two lines (`… rollback path too: a downgrade prints the coord.db restore` / `commands and never auto-restores. Never automatic; per box;` / `fleet box first, then the server box`) with:

```
            rollback path too: a downgrade prints the coord.db restore
            commands and never auto-restores. A box already running the
            target, whose install completed, is left alone (--force
            reinstalls). --check only compares this box with what is
            published (exit 0 current, 1 otherwise) and writes nothing.
            Per box; across a fleet, 'ccrc rollout' runs it in order
```

(Same line count as before plus three; the usage text is not line-budgeted.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts` (whole file, foreground, ≥ 600000 ms). Expected: all PASS, including every pre-existing case — the split must not change the URL order the `--to` case pins.

- [ ] **Step 5: Mutation measurements**

Drop each comparison in `_upd_converged` one at a time: (a) the version check → the "different version" case RED; (b) `staged == box` → the moved-tag case RED; (c) the record check → the record-absent and stale cases RED. (d) Make `--check` skip `_upd_resolve` → the URL assertions RED. (e) Move the gate below `_upd_backup` → the skip case's no-backup assertion RED.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-update.test.ts
git commit -m "feat(ccrc): update --check and --force, and the gate that leaves a converged box alone — three matching shas, no backup, no restart, no sweep"
```

---

### Task 5: `ccrc rollout` — one act, both boxes, in order

**Files:**
- Modify: `ccd/ccrc` — file-scope `ROLLOUT_SSH=()` / `ROLLOUT_VERSION=""` beside the `UPD_*` declarations; new `_rollout_need`, `_rollout_role`, `cmd_rollout`; the verb table (`rollout) cmd_rollout "$@" ;;`); `usage()` (verb list + entry).
- Create: `server/test/ccrc-rollout.test.ts`.

**Interfaces:**
- Consumes: `_upd_resolve "$to"` (Task 4; sets `UPD_VERSION`, fetches only SHA256SUMS); the `check:` first line of `ccrc update --check --to <v>` (Task 4); `ccrc version`'s `version vX.Y.Z` line; `/health`'s top-level `version`.
- Produces: `ccrc rollout [--to vX.Y.Z] [--server-first] [--check] [--force]`; exit 2 usage/coordinates/preflight (nothing touched), 1 a box failed or verification disagreed, 0 done or nothing to do.

- [ ] **Step 1: Write the failing tests**

`server/test/ccrc-rollout.test.ts`:

```ts
// `ccrc rollout` — spec §4. The verb runs on the deploying machine and drives
// `ccrc update` on each box over ssh. Fixture: a stub `ssh` that RECORDS every
// `<host> <command>` and answers from per-host fixture files, the update
// suite's combined curl (local:// release space), real jq, and a deploy.env
// the test writes. No real ssh, no network, no live HOME.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const JQ = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
if (JQ === '') throw new Error('this box has no jq — the fixture needs it');

const FLEET = 'user@fleet-host';
const SERVER = 'user@server-host';
const SHA_OLD = 'oldsha0000000000000000000000000000000000';
const SHA_NEW = 'newsha0000000000000000000000000000000000';

interface Result { code: number; stdout: string; stderr: string }

/** Per-host state the ssh stub reads: role, current version, update exit. */
function plantHost(home: string, host: string, o: { role?: string; version?: string; sha?: string; updateExit?: number; installed?: boolean } = {}): void {
  const d = join(home, 'hosts', host);
  mkdirSync(d, { recursive: true });
  if (o.role !== undefined) writeFileSync(join(d, 'role'), `${o.role}\n`);
  writeFileSync(join(d, 'version'), `${o.version ?? ''}\n`);
  writeFileSync(join(d, 'sha'), `${o.sha ?? SHA_OLD}\n`);
  writeFileSync(join(d, 'update-exit'), `${o.updateExit ?? 0}\n`);
  writeFileSync(join(d, 'installed'), o.installed === false ? 'no\n' : 'yes\n');
}

function plantBox(home: string): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  const plant = (name: string, body: string): void =>
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  // THE SSH STUB. argv: -p PORT -i KEY -o BatchMode=yes HOST CMD. Records
  // "HOST CMD" and answers CMD from <home>/hosts/<HOST>/*:
  //   grep … CCRC_ROLE …      -> the role file's value (nothing if absent)
  //   ccrc update --check …   -> a `check:` line built from version/sha/installed
  //   ccrc update --to …      -> exit update-exit; on 0, version := target
  //   ccrc version            -> "ccrc <sha> (release, built …)" + "version <v>"
  //   curl … /health          -> {"ok":true,"version":"<v>"}
  plant('ssh', [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do case "$1" in -p|-i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done',
    'host="$1"; shift; cmd="$*"',
    'printf \'%s\\n\' "$host $cmd" >> "$HOME/ssh-argv"',
    'd="$HOME/hosts/$host"; [ -d "$d" ] || { echo "ssh: could not resolve hostname $host" >&2; exit 255; }',
    'IFS= read -r ver < "$d/version"; IFS= read -r sha < "$d/sha"; IFS= read -r inst < "$d/installed"',
    'case "$cmd" in',
    '  *CCRC_ROLE*) [ -f "$d/role" ] && cat "$d/role"; exit 0 ;;',
    '  "ccrc update --check --to "*)',
    '    tgt="${cmd##* }"',
    '    if [ -z "$ver" ]; then state=unversioned; box=unversioned',
    '    elif [ "$ver" != "$tgt" ]; then state=behind; box="$ver"',
    '    elif [ "$inst" = yes ]; then state=current; box="$ver"',
    '    else state=incomplete; box="$ver"; fi',
    '    echo "check: box=$box sha=$sha target=$tgt state=$state"',
    '    [ "$state" = current ] && exit 0; exit 1 ;;',
    '  "ccrc update --to "*)',
    '    IFS= read -r rc < "$d/update-exit"',
    '    echo "update: fixture ran on $host: $cmd"',
    `    if [ "$rc" -eq 0 ]; then set -- $cmd; echo "$4" > "$d/version"; echo "${SHA_NEW}" > "$d/sha"; fi`,
    '    exit "$rc" ;;',
    '  "ccrc version") echo "ccrc $sha (release, built 2026-09-18T00:00:00Z)"; [ -n "$ver" ] && echo "version $ver"; exit 0 ;;',
    '  *"/health"*) printf \'{"ok":true,"build":{"sha":"%s"},"version":"%s"}\\n\' "$sha" "$ver"; exit 0 ;;',
    'esac',
    'echo "fixture ssh: unexpected command: $cmd" >&2; exit 90',
  ].join('\n'));
  // curl: local:// release space (SHA256SUMS only — the pin reads nothing else), recorded.
  plant('curl', [
    '#!/bin/sh',
    'dest=""; url=""',
    'while [ $# -gt 0 ]; do case "$1" in -o) dest="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done',
    'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
    'src="${url#local://}"; [ -f "$src" ] || { echo "curl: (22) 404 for $url" >&2; exit 22; }',
    'cp "$src" "$dest"',
  ].join('\n'));
  symlinkSync(JQ, join(home, '.local', 'bin', 'jq'));
}

function plantRelease(home: string, tag: string, latest = true): void {
  const dir = latest ? join(home, 'releases', 'latest', 'download') : join(home, 'releases', 'download', tag);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SHA256SUMS'), `${'0'.repeat(64)}  ccrc-${tag}.tar.gz\n`);
}

function plantDeployEnv(home: string, lines: string[] = [
  `CCRC_BOX=${SERVER}`, `CCRC_AGENT_BOX=${FLEET}`, `CCRC_SSH_KEY=${join(home, 'id_fixture')}`, 'CCRC_SSH_PORT=2222',
]): void {
  writeFileSync(join(home, 'deploy.env'), `${lines.join('\n')}\n`);
}

/** A two-box fleet, both behind, roles recorded, latest v2.0.0 published. */
function twoBoxFleet(prefix: string): string {
  const home = mkTmp(prefix);
  plantBox(home);
  plantDeployEnv(home);
  plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0' });
  plantHost(home, SERVER, { role: 'server', version: 'v1.0.0' });
  plantRelease(home, 'v2.0.0');
  return home;
}

function run(home: string, args: string[] = []): Result {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  for (const k of ['CCRC_BOX', 'CCRC_AGENT_BOX', 'CCRC_SSH_KEY', 'CCRC_SSH_PORT', 'CCRC_RELEASE_BASE_URL', 'CCRC_DEPLOY_ENV']) delete env[k];
  env['CCRC_DEPLOY_ENV'] = join(home, 'deploy.env');
  env['CCRC_RELEASE_BASE_URL'] = `local://${home}/releases`;
  env['TMPDIR'] = join(home, 'tmp'); mkdirSync(env['TMPDIR'], { recursive: true });
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollout', ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const sshCalls = (home: string): string[] => (existsSync(join(home, 'ssh-argv'))
  ? readFileSync(join(home, 'ssh-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);
const updates = (home: string): string[] => sshCalls(home).filter((l) => / ccrc update --to /.test(l));

describe('ccrc rollout: refusals before any box is touched (exit 2, no ssh)', () => {
  it('a missing coordinate names the key and the file', () => {
    const home = twoBoxFleet('ccrc-rollout-coord-');
    plantDeployEnv(home, [`CCRC_BOX=${SERVER}`, `CCRC_SSH_KEY=${join(home, 'k')}`]);   // no CCRC_AGENT_BOX
    const r = run(home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/\$CCRC_AGENT_BOX is not set/);
    expect(r.stderr).toContain(join(home, 'deploy.env'));
    expect(sshCalls(home)).toEqual([]);
  });

  it('a box with no recorded role, or the wrong one, gets no update — an absent role installs "both"', () => {
    const home = twoBoxFleet('ccrc-rollout-role-');
    plantHost(home, SERVER, { version: 'v1.0.0' });   // role file absent
    let r = run(home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/server box \(CCRC_BOX\) records CCRC_ROLE=nothing, not 'server'/);
    expect(updates(home)).toEqual([]);
    plantHost(home, SERVER, { role: 'fleet', version: 'v1.0.0' });
    r = run(home);
    expect(r.code).toBe(2);
    expect(updates(home)).toEqual([]);
  });

  it('an unknown argument and a malformed --to are usage errors', () => {
    const home = twoBoxFleet('ccrc-rollout-usage-');
    expect(run(home, ['--bogus']).code).toBe(2);
    expect(run(home, ['--to', '2.0.0']).code).toBe(2);
    expect(sshCalls(home)).toEqual([]);
  });
});

describe('ccrc rollout: pin, measure, update in order, verify', () => {
  it('pins the version from SHA256SUMS before any update, passes the same --to to both boxes, fleet then server, and verifies by re-measurement', () => {
    const home = twoBoxFleet('ccrc-rollout-happy-');
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The pin: one SHA256SUMS read, before the first ssh update.
    expect(readFileSync(join(home, 'curl-argv'), 'utf8').trim()).toBe(`local://${home}/releases/latest/download/SHA256SUMS`);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
    // The plan was printed from the check line, per box.
    expect(r.stdout).toMatch(/^rollout: fleet: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    expect(r.stdout).toMatch(/^rollout: server: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    // Verification read `ccrc version` on both and /health on the server.
    const calls = sshCalls(home);
    expect(calls.filter((l) => l.endsWith(' ccrc version'))).toEqual([`${FLEET} ccrc version`, `${SERVER} ccrc version`]);
    expect(calls.some((l) => l.startsWith(`${SERVER} curl`) && l.includes('127.0.0.1:7788/health'))).toBe(true);
    expect(r.stdout).toMatch(/^rollout: fleet v2\.0\.0 \(newsha00\) · server v2\.0\.0 \(newsha00\) — agreed$/m);
    // The update ran AFTER the check on every box (the check pins the plan).
    const idxCheck = calls.findIndex((l) => l.includes('--check'));
    const idxUpdate = calls.findIndex((l) => / ccrc update --to /.test(l));
    expect(idxCheck).toBeLessThan(idxUpdate);
  });

  it('--to pins that tag and reads its own URL space', () => {
    const home = twoBoxFleet('ccrc-rollout-to-');
    plantRelease(home, 'v1.5.0', false);
    const r = run(home, ['--to', 'v1.5.0']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'curl-argv'), 'utf8').trim()).toBe(`local://${home}/releases/download/v1.5.0/SHA256SUMS`);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v1.5.0`, `${SERVER} ccrc update --to v1.5.0`]);
  });

  it('--server-first inverts the order', () => {
    const home = twoBoxFleet('ccrc-rollout-inverted-');
    const r = run(home, ['--server-first']);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${SERVER} ccrc update --to v2.0.0`, `${FLEET} ccrc update --to v2.0.0`]);
  });

  it('box one fails → stop: box two is never touched, exit 1, the message says so', () => {
    const home = twoBoxFleet('ccrc-rollout-stop-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0', updateExit: 1 });
    const r = run(home);
    expect(r.code).toBe(1);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`]);
    expect(r.stderr).toMatch(/the fleet box's update exited 1 — stopped here\. The server box was not touched/);
    expect(r.stdout).toMatch(/^fleet: update: fixture ran on user@fleet-host/m);   // streamed, prefixed
  });

  it('--check measures and stops: no update argv; exit 1 while any box is behind, 0 when all current', () => {
    const home = twoBoxFleet('ccrc-rollout-check-');
    let r = run(home, ['--check']);
    expect(r.code).toBe(1);
    expect(updates(home)).toEqual([]);
    expect(r.stdout).toMatch(/\[behind\]/);
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0' });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    r = run(home, ['--check']);
    expect(r.code).toBe(0);
    expect(updates(home)).toEqual([]);
  });

  it('every box current and no --force → nothing to do, exit 0, no update; --force updates anyway', () => {
    const home = twoBoxFleet('ccrc-rollout-noop-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0' });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    let r = run(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^rollout: every box already runs v2\.0\.0 — nothing to do$/m);
    expect(updates(home)).toEqual([]);
    r = run(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0 --force`, `${SERVER} ccrc update --to v2.0.0 --force`]);
  });

  it('a box whose install never completed is not "current" — it gets its update', () => {
    const home = twoBoxFleet('ccrc-rollout-incomplete-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0', installed: false });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    const r = run(home);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
  });

  it('a single-box fleet (same host in both coordinates) needs CCRC_ROLE=both and updates once', () => {
    const home = twoBoxFleet('ccrc-rollout-single-');
    plantDeployEnv(home, [`CCRC_BOX=${SERVER}`, `CCRC_AGENT_BOX=${SERVER}`, `CCRC_SSH_KEY=${join(home, 'k')}`]);
    plantHost(home, SERVER, { role: 'both', version: 'v1.0.0' });
    const r = run(home);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${SERVER} ccrc update --to v2.0.0`]);
  });

  it('verification disagreeing with the target is exit 1 and names the box', () => {
    const home = twoBoxFleet('ccrc-rollout-verify-');
    // The server's "update" exits 0 but the fixture leaves its version alone.
    const d = join(home, 'hosts', SERVER);
    writeFileSync(join(d, 'update-exit'), '0\n');
    writeFileSync(join(home, '.local', 'bin', 'ssh'),
      readFileSync(join(home, '.local', 'bin', 'ssh'), 'utf8').replace('echo "$4" > "$d/version"', '[ "$host" = "user@fleet-host" ] && echo "$4" > "$d/version"'));
    const r = run(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/server box reports v1\.0\.0, not v2\.0\.0/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-rollout.test.ts`
Expected: every case FAILS — `rollout` is an unknown verb (usage, exit 2) and no ssh call is recorded.

- [ ] **Step 3: Implement**

File scope, beside `UPD_BACKUP_DIR=""`:

```bash
ROLLOUT_SSH=()       # cmd_rollout: the ssh argv built from deploy.env's coordinates
ROLLOUT_VERSION=""   # cmd_rollout: the ONE version both boxes are moved to
```

Helpers, placed before `cmd_rollout`:

```bash
# ── _rollout_need — deploy.sh's `_deploy_need`, the verb's own words ──────
# Exit 2, nothing touched. There is deliberately no default: a rollout that
# guessed its target would update someone else's box.
_rollout_need() {   # <value> <name> <what> <envfile>
  [ -n "$1" ] && return 0
  echo "$PROG: rollout: \$$2 is not set ($3)." >&2
  echo "  Set it in $4, or pass it in the environment. There is deliberately no default: a rollout that guessed its target would update someone else's box." >&2
  exit 2
}

# ── _rollout_role — the ONE line of a box's ccrc.env this verb reads ──────
# `grep` on the remote, never `cat`: ccrc.env is the box's live config and
# may carry tokens; only the role's value crosses back.
_rollout_role() {   # <user@host> -> the recorded CCRC_ROLE, or ""
  "${ROLLOUT_SSH[@]}" "$1" 'grep -m1 "^CCRC_ROLE=" "$HOME/.ccrc/ccrc.env" 2>/dev/null | cut -d= -f2-' 2>/dev/null \
    | tr -d '[:space:]' || :
}
```

`cmd_rollout` (before the verb table's `update)` neighbour, e.g. right after `_upd_report`):

```bash
# ── cmd_rollout — one act, both boxes, in order (release/rollout design §4)
# Runs on the deploying machine, needs no checkout. Coordinates are
# deploy.sh's (`~/.ccrc/deploy.env`); the boxes' recorded roles are
# preflighted BEFORE anything runs (an absent role installs `both`); the
# version is pinned from SHA256SUMS ONCE and passed to both boxes, so a
# release landing mid-rollout cannot split the fleet; box two is never
# touched when box one fails; and the result is RE-MEASURED (`ccrc version`
# on each box, `/health` on the server), never read off update's stdout.
cmd_rollout() {
  local to="" server_first=0 check=0 force=0
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --to)
        [ $# -ge 2 ] || { echo "$PROG: --to needs a value: a release tag shaped vX.Y.Z" >&2; usage >&2; exit 2; }
        to="$2"; shift ;;
      --to=*) to="${1#--to=}" ;;
      --server-first) server_first=1 ;;
      --check) check=1 ;;
      --force) force=1 ;;
      *) _ccrc_usage_die "$1" ;;
    esac
    shift
  done
  if [ -n "$to" ] && [[ ! "$to" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$PROG: --to expects a release tag shaped vX.Y.Z (got: $to)" >&2; usage >&2; exit 2
  fi
  local t
  for t in ssh curl jq; do
    command -v "$t" >/dev/null 2>&1 || _ccrc_die "$t is required by 'ccrc rollout' but is not on PATH — nothing was touched"
  done

  # Step 0 — coordinates.
  local envf="${CCRC_DEPLOY_ENV:-$HOME/.ccrc/deploy.env}"
  # shellcheck source=/dev/null
  [ -r "$envf" ] && . "$envf"
  _rollout_need "${CCRC_BOX:-}" CCRC_BOX "the server box, user@host" "$envf"
  _rollout_need "${CCRC_AGENT_BOX:-}" CCRC_AGENT_BOX "the fleet box, user@host — never defaulted from CCRC_BOX" "$envf"
  _rollout_need "${CCRC_SSH_KEY:-}" CCRC_SSH_KEY "the ssh identity file that reaches both boxes" "$envf"
  ROLLOUT_SSH=(ssh -p "${CCRC_SSH_PORT:-22}" -i "$CCRC_SSH_KEY" -o BatchMode=yes)

  # Step 1 — preflight the roles, before touching either box.
  local single=0 frole="" srole=""
  [ "$CCRC_AGENT_BOX" = "$CCRC_BOX" ] && single=1
  frole="$(_rollout_role "$CCRC_AGENT_BOX")"
  if [ "$single" -eq 1 ]; then
    [ "$frole" = both ] || {
      echo "$PROG: rollout: CCRC_BOX and CCRC_AGENT_BOX name the same host, which records CCRC_ROLE=${frole:-nothing}, not 'both' — nothing was touched" >&2; exit 2; }
  else
    srole="$(_rollout_role "$CCRC_BOX")"
    [ "$frole" = fleet ] || {
      echo "$PROG: rollout: the fleet box (CCRC_AGENT_BOX) records CCRC_ROLE=${frole:-nothing}, not 'fleet' — its update would install the wrong role; nothing was touched" >&2; exit 2; }
    [ "$srole" = server ] || {
      echo "$PROG: rollout: the server box (CCRC_BOX) records CCRC_ROLE=${srole:-nothing}, not 'server' — its update would install the wrong role (an absent role installs 'both': an agent unit on the server box); nothing was touched" >&2; exit 2; }
  fi

  # Step 2 — pin the version: ONE SHA256SUMS read, the same read update makes.
  _upd_resolve "$to"
  ROLLOUT_VERSION="$UPD_VERSION"
  echo "rollout: target $ROLLOUT_VERSION"

  local -a boxes=() labels=()
  if [ "$single" -eq 1 ]; then boxes=("$CCRC_BOX"); labels=(box)
  elif [ "$server_first" -eq 1 ]; then boxes=("$CCRC_BOX" "$CCRC_AGENT_BOX"); labels=(server fleet)
  else boxes=("$CCRC_AGENT_BOX" "$CCRC_BOX"); labels=(fleet server); fi

  # Step 3 — measure, then decide. `--check`'s first line is fixed-shape.
  local i out line state box sha allcurrent=1
  for i in "${!boxes[@]}"; do
    out="$("${ROLLOUT_SSH[@]}" "${boxes[$i]}" "ccrc update --check --to $ROLLOUT_VERSION" 2>&1)" || :
    line="${out%%$'\n'*}"
    case "$line" in
      "check: "*) ;;
      *) _ccrc_die "rollout: the ${labels[$i]} box's 'ccrc update --check' printed no check line (got: ${line:-nothing}) — is ccrc installed there, and new enough to know --check?" ;;
    esac
    box="${line#*box=}"; box="${box%% *}"
    sha="${line#*sha=}"; sha="${sha%% *}"
    state="${line##*state=}"
    echo "rollout: ${labels[$i]}: $box (${sha:0:8}) → $ROLLOUT_VERSION [$state]"
    [ "$state" = current ] || allcurrent=0
  done
  if [ "$check" -eq 1 ]; then
    [ "$allcurrent" -eq 1 ] && return 0
    return 1
  fi
  if [ "$allcurrent" -eq 1 ] && [ "$force" -eq 0 ]; then
    echo "rollout: every box already runs $ROLLOUT_VERSION — nothing to do"
    return 0
  fi

  # Steps 4–5 — each box in order; stop on the first failure.
  local forceflag="" rc=0 untouched=""
  [ "$force" -eq 1 ] && forceflag=" --force"
  for i in "${!boxes[@]}"; do
    echo "rollout: ${labels[$i]}: ccrc update --to $ROLLOUT_VERSION$forceflag"
    "${ROLLOUT_SSH[@]}" "${boxes[$i]}" "ccrc update --to $ROLLOUT_VERSION$forceflag" 2>&1 | sed "s/^/${labels[$i]}: /"
    rc="${PIPESTATUS[0]}"
    if [ "$rc" -ne 0 ]; then
      untouched=""
      [ "$i" -eq 0 ] && [ "${#boxes[@]}" -eq 2 ] && untouched=" The ${labels[1]} box was not touched."
      _ccrc_die "rollout: the ${labels[$i]} box's update exited $rc — stopped here.$untouched Its lines above name the backup taken before anything changed; deploy.sh remains the fallback"
    fi
  done

  # Step 6 — verify by re-measurement.
  local v="" report="" bad=0
  for i in "${!boxes[@]}"; do
    out="$("${ROLLOUT_SSH[@]}" "${boxes[$i]}" 'ccrc version' 2>/dev/null)" || out=""
    v="$(printf '%s\n' "$out" | awk '/^version /{print $2; exit}')"
    sha="$(printf '%s\n' "$out" | awk 'NR==1{print $2; exit}')"
    if [ "$v" != "$ROLLOUT_VERSION" ]; then
      echo "$PROG: rollout: the ${labels[$i]} box reports ${v:-no version}, not $ROLLOUT_VERSION, after its update — read that box's lines above" >&2; bad=1
    fi
    report="$report${report:+ · }${labels[$i]} ${v:-unversioned} (${sha:0:8})"
  done
  if [ "$single" -eq 1 ] || [ "${labels[*]}" != "${labels[*]/server/}" ]; then
    v="$("${ROLLOUT_SSH[@]}" "$CCRC_BOX" 'curl -fsS http://127.0.0.1:7788/health' 2>/dev/null | jq -r '.version // empty' 2>/dev/null)" || v=""
    if [ "$v" != "$ROLLOUT_VERSION" ]; then
      echo "$PROG: rollout: the server box reports ${v:-no version}, not $ROLLOUT_VERSION, on /health after its restart" >&2; bad=1
    fi
  fi
  if [ "$bad" -ne 0 ]; then
    echo "rollout: $report — NOT agreed"; return 1
  fi
  echo "rollout: $report — agreed"
}
```

Verb table: add `  rollout) cmd_rollout "$@" ;;` beside `update)`. `usage()`: the verb list line gains `rollout` after `update`, and a new entry after the `update` entry:

```
  rollout   move BOTH boxes of a fleet to one published release, in order,
            from this machine: reads ~/.ccrc/deploy.env (deploy.sh's
            coordinates), preflights each box's recorded CCRC_ROLE, pins the
            version from SHA256SUMS once, runs 'ccrc update --to' over ssh on
            the fleet box then the server box (--server-first inverts), stops
            at the first failure, and re-measures both ('ccrc version',
            /health). --check only prints where each box stands; --force
            passes through; [--to vX.Y.Z] pins a tag. Exit 2 = nothing touched
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-rollout.test.ts`. Expected: all PASS. Then `test/ccrc-cli.test.ts` (the usage/verb-table pins there must still hold — if a case pins the exact verb list, extend it with `rollout`).

- [ ] **Step 5: Mutation measurements**

1. derive `--to` per box (call `_upd_resolve` inside the update loop) → the "pins first" case's single-curl assertion RED; 2. delete the role preflight → the role case RED; 3. replace the `if [ "$rc" -ne 0 ]` stop with `:` → the stop case RED; 4. verify from update's stdout (`grep 'update: build:'`) instead of `ccrc version` → the verify case RED; 5. delete `--check`'s early return → its no-update assertion RED.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-rollout.test.ts
git commit -m "feat(ccrc): rollout — one verb moves both boxes to one pinned release, in order, preflighted, stop-on-first-failure, re-measured"
```

---

### Task 6: `FleetHealth.builds` — the evidence beside the decision

**Files:**
- Modify: `shared/api.ts` (`FleetHealth`), `server/src/server.ts` (the `/api/fleet/health` remote arm)
- Modify: `server/test/fleet-health.test.ts`, `server/test/fleet-build-skew.test.ts`

**Interfaces:**
- Produces: `FleetHealth.builds?: { own: BuildInfo | null; fleet: BuildInfo | null }` — present in remote mode only; `BuildInfo` from `shared/buildinfo.ts` (already imported by `shared/api.ts`). Task 7 reads it.

- [ ] **Step 1: Write the failing tests**

In `server/test/fleet-build-skew.test.ts`, inside the describe that uses `healthOf` (grep `healthOf(`), add:

```ts
  it('carries BOTH stamps as `builds` beside the agreement — version included when a stamp has one (spec §6)', async () => {
    const fleet: BuildInfo = { sha: 'abc1234', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.7' };
    const own: BuildInfo = { ...OWN, version: 'v0.0.9', sha: 'def5678' };
    const h = await healthOf(remoteDeps(fleet, own));
    expect(h['build']).toBe('skewed');
    expect(h['builds']).toEqual({ own, fleet });
  });

  it('`builds` is honest about absence: null per side, never a fabricated stamp', async () => {
    const h = await healthOf(remoteDeps(null, OWN));
    expect(h['build']).toBe('unknown');
    expect(h['builds']).toEqual({ own: OWN, fleet: null });
  });
```

In `server/test/fleet-health.test.ts`, the `local mode` case's `toEqual` literal stays exactly as it is (no `builds` key in local mode) — that existing assertion IS the local-mode pin. Add one case:

```ts
  it('never emits `builds` in local mode — there is no second box to show', async () => {
    const app = await buildServer(testDeps());
    const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
    expect('builds' in body).toBe(false);
    await app.close();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet-build-skew.test.ts test/fleet-health.test.ts`
Expected: the two `builds` cases FAIL (`undefined`); the local-mode case passes already.

- [ ] **Step 3: Implement**

`shared/api.ts`, in `interface FleetHealth`, directly after the `build?: BuildAgreement;` member:

```ts
  /**
   * The EVIDENCE beside the decision (release/rollout design §6): what THIS
   * box's stamp says and what the fleet host's stamp said on its last
   * `ready`, each `null` when that side has no readable stamp. `build`
   * above still decides — a reader renders `skewed`/`agreed`/`unknown`
   * from it and uses these only to SAY which versions are involved
   * (`version` is optional per `BuildInfo`; a deploy.sh stamp has none).
   * Remote mode only, optional so an older server's response still parses.
   */
  builds?: { own: BuildInfo | null; fleet: BuildInfo | null };
```

`server/src/server.ts`, in the remote-mode literal, directly after the `build: buildAgreement(…)` line:

```ts
        builds: { own: deps.build ?? null, fleet: deps.fleetState.build ?? null },
```

- [ ] **Step 4: Run to verify they pass**

Same two files. Expected: PASS, every pre-existing `toEqual` on the remote arm updated only where it enumerated the whole body: search `fleet-health.test.ts` for `toEqual({ mode: 'remote'` and add `builds: { own: null, fleet: null }` to each such literal (those fixtures pass `build: null` and no `Deps.build`). Then `cd server && npx tsc --noEmit -p .` must be clean.

- [ ] **Step 5: Mutation measurements**

Delete the `builds:` line → both new skew cases RED. Emit `builds` in the local arm too → the local-mode pin RED.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/server.ts server/test/fleet-health.test.ts server/test/fleet-build-skew.test.ts
git commit -m "feat(fleet-health): builds — both stamps ride beside the agreement so a reader can say which versions disagree"
```

---

### Task 7: The PWA — the skewed arm and `BuildLine`

**Files:**
- Create: `pwa/src/fleet/useFleetHealth.ts`, `pwa/src/fleet/BuildLine.tsx`, `pwa/test/build-line.test.tsx`
- Modify: `pwa/src/fleet/FleetHostBanner.tsx` (optional `health` prop; skewed arm), `pwa/src/screens/FleetScreen.tsx` (one poll, two consumers), `pwa/src/fleet/fleet.css`, `pwa/test/fleet-host-banner.test.tsx`

**Interfaces:**
- Consumes: `FleetHealth.builds` (Task 6), `api.fleetHealth()` (`pwa/src/lib/api.ts`).
- Produces: `useFleetHealth(pollMs = 15_000): FleetHealth | null`; `FleetHostBanner({ health?: FleetHealth | null })` — when the prop is given it does not poll; `BuildLine({ health }: { health: FleetHealth | null })`.

- [ ] **Step 1: Write the failing tests**

Append to `pwa/test/fleet-host-banner.test.tsx`, inside `describe('FleetHostBanner'`:

```tsx
  it('warns when the boxes run DIFFERENT builds, naming both versions and the verb (spec §6)', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({
      connected: true, downSince: null, roster: 'agreed', build: 'skewed',
      builds: {
        fleet: { sha: 'bd2bf57a8733883085b3c118911fc983dc441299', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.7' },
        own: { sha: '2985b9d1000000000000000000000000000000000', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.9' },
      },
    }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.getByText(/fleet v0\.0\.7 \(bd2bf57a\)/)).toBeInTheDocument();
    expect(screen.getByText(/server v0\.0\.9 \(2985b9d1\)/)).toBeInTheDocument();
    expect(screen.getByText(/ccrc rollout/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a skewed side with no version reads as unversioned (a deploy.sh stamp)', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({
      connected: true, downSince: null, build: 'skewed',
      builds: {
        fleet: { sha: 'bd2bf57a8733883085b3c118911fc983dc441299', ref: 'HEAD', builtAt: '2026-09-17T17:16:09Z', dirty: false },
        own: { sha: '2985b9d1000000000000000000000000000000000', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.9' },
      },
    }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/fleet unversioned \(bd2bf57a\)/)).toBeInTheDocument();
  });

  it('skewed from an OLDER server (no builds field) still warns, without versions', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ connected: true, downSince: null, build: 'skewed' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/run different builds/i)).toBeInTheDocument();
  });

  it('takes an injected health and does not poll — FleetScreen polls once for two readers', async () => {
    const spy = vi.spyOn(api, 'fleetHealth');
    render(<FleetHostBanner health={health({ connected: true, downSince: null, roster: 'divergent' })} />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
```

`pwa/test/build-line.test.tsx`:

```tsx
// BuildLine — the always-visible one-liner at the foot of FleetScreen
// (spec §6): which version each box runs, amber for unversioned/dirty,
// a dash for unknown, nothing at all when the server is older than the
// field or the fleet is local.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FleetHealth } from '../../shared/api';
import { BuildLine } from '../src/fleet/BuildLine';

afterEach(cleanup);

const stamp = (sha: string, version?: string, dirty = false) =>
  ({ sha, ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty, ...(version ? { version } : {}) });
const remote = (over: Partial<FleetHealth>): FleetHealth =>
  ({ mode: 'remote', connected: true, downSince: null, ...over });

describe('BuildLine', () => {
  it('renders both versions when both stamps carry one', () => {
    render(<BuildLine health={remote({ build: 'agreed', builds: { fleet: stamp('bd2bf57a' + '0'.repeat(32), 'v0.0.7'), own: stamp('bd2bf57a' + '0'.repeat(32), 'v0.0.7') } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('fleet v0.0.7 · server v0.0.7');
    expect(screen.queryByText(/unversioned/)).not.toBeInTheDocument();
  });

  it('renders an unversioned side amber with its short sha, and a dirty side amber', () => {
    render(<BuildLine health={remote({ build: 'skewed', builds: { fleet: stamp('bd2bf57a' + '0'.repeat(32)), own: stamp('2985b9d1' + '0'.repeat(32), 'v0.0.9', true) } })} />);
    expect(screen.getByText('fleet unversioned (bd2bf57a)')).toHaveClass('build-line-side--warn');
    expect(screen.getByText('server v0.0.9 dirty')).toHaveClass('build-line-side--warn');
  });

  it('renders a dash for a side with no stamp', () => {
    render(<BuildLine health={remote({ build: 'unknown', builds: { fleet: null, own: stamp('2985b9d1' + '0'.repeat(32), 'v0.0.9') } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('fleet — · server v0.0.9');
  });

  it('renders nothing in local mode, for a null health, or when the server sends no builds', () => {
    const { rerender } = render(<BuildLine health={null} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<BuildLine health={{ mode: 'local', connected: true, downSince: null }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<BuildLine health={remote({ build: 'agreed' })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx test/build-line.test.tsx`
Expected: the new banner cases FAIL (no skewed arm; the `health` prop is a type error); `build-line.test.tsx` FAILS to import.

- [ ] **Step 3: Implement**

`pwa/src/fleet/useFleetHealth.ts`:

```ts
import { useEffect, useState } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { api } from '../lib/api';

/** One poll of /api/fleet/health every `pollMs`, newest issued request
 *  authoritative (an older in-flight answer never overwrites a newer one).
 *  Lifted out of FleetHostBanner so FleetScreen can poll ONCE and hand the
 *  answer to both the banner and BuildLine (spec §6: one request, not two). */
export function useFleetHealth(pollMs = 15_000): FleetHealth | null {
  const [health, setHealth] = useState<FleetHealth | null>(null);
  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls (FleetHostBanner with `health`)
    let live = true;
    let issued = 0;
    const load = (): void => {
      const mine = ++issued;
      void api.fleetHealth().then((h) => { if (live && mine === issued) setHealth(h); }).catch(() => {});
    };
    load();
    const t = setInterval(load, pollMs);
    return () => { live = false; clearInterval(t); };
  }, [pollMs]);
  return health;
}
```

`pwa/src/fleet/BuildLine.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import './fleet.css';

/** "v0.0.7" / "unversioned (bd2bf57a)" / "—", plus " dirty"; amber unless
 *  the side is a clean, versioned release stamp. */
function side(label: string, b: BuildInfo | null): ReactNode {
  if (b === null) return <span className="build-line-side build-line-side--warn">{label} —</span>;
  const name = b.version ?? `unversioned (${b.sha.slice(0, 8)})`;
  const warn = b.version === undefined || b.dirty;
  return (
    <span className={`build-line-side${warn ? ' build-line-side--warn' : ''}`}>
      {label} {name}{b.dirty ? ' dirty' : ''}
    </span>
  );
}

/** Always visible at the foot of FleetScreen (spec §6). Renders nothing for
 *  local mode, for no answer yet, or for a server older than `builds`. */
export function BuildLine({ health }: { health: FleetHealth | null }): ReactNode {
  if (!health || health.mode !== 'remote' || !health.builds) return null;
  return (
    <div className="build-line" role="status">
      {side('fleet', health.builds.fleet)}
      <span className="build-line-sep"> · </span>
      {side('server', health.builds.own)}
    </div>
  );
}
```

`pwa/src/fleet/FleetHostBanner.tsx`: replace the `useState`/`useEffect` poll (the `const [health, setHealth] = useState…` line and the whole `useEffect(() => { … }, [])` block) with

```tsx
export function FleetHostBanner({ health: injected }: { health?: FleetHealth | null } = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for this
  // banner and BuildLine together; the standalone shape (tests, other
  // screens) still self-polls.
  const polled = useFleetHealth(injected === undefined ? POLL_MS : 0);
  const health = injected === undefined ? polled : injected;
```

Import `useFleetHealth` from `./useFleetHealth`; drop the now-unused `useEffect`/`useState` imports if nothing else uses them.

Add the skewed arm directly AFTER the `roster === 'divergent'` arm and BEFORE the `projectPools` arm:

```tsx
  if (health && health.mode === 'remote' && health.connected && health.build === 'skewed') {
    const name = (b: BuildInfo | null | undefined): string =>
      b ? (b.version ?? `unversioned (${b.sha.slice(0, 8)})`) : '—';
    const fleet = health.builds ? ` fleet ${name(health.builds.fleet)} · server ${name(health.builds.own)}.` : '';
    return (
      <div className="fleet-host-banner fleet-host-banner--warn" role="status">
        <span className="fleet-host-banner-msg">
          The two boxes run different builds.{fleet} Run <code>ccrc rollout</code> from the deploying
          machine, or <code>ccrc update</code> on the lagging box, fleet box first.
        </span>
      </div>
    );
  }
```

with `import type { BuildInfo } from '../../../shared/buildinfo';`. The test's `getByText(/fleet v0\.0\.7 \(bd2bf57a\)/)` matches within that one span's text.

`pwa/src/screens/FleetScreen.tsx`: import `useFleetHealth` and `BuildLine`; inside the component body (beside the other hooks) `const fleetHealth = useFleetHealth();`; change `<FleetHostBanner />` to `<FleetHostBanner health={fleetHealth} />`; and add `<BuildLine health={fleetHealth} />` as the LAST child of the screen's outermost returned element (after the fleet list / skeleton block — the foot of the screen).

`pwa/src/fleet/fleet.css`, after the `.fleet-host-banner--warn code` rule:

```css
/* BuildLine — the foot-of-screen one-liner (release/rollout design §6).
 * Quiet by default; a side that is unversioned, dirty or unknown borrows
 * the warn banner's attention-text token so a deploy.sh box LOOKS
 * second-class without a banner that fires when nothing is wrong. */
.build-line {
  padding: 6px 16px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
.build-line-side--warn {
  color: var(--attention-text);
}
```

(Use the same two custom-property names the `.fleet-host-banner--warn` rule uses for its text colour — read that rule and copy its tokens; if it uses different names, use those.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx test/build-line.test.tsx`, then the whole `cd pwa && npm run test` and `npm run build`. Expected: PASS; the pre-existing banner cases (including "keeps the newest issued poll authoritative") still pass through the hook.

- [ ] **Step 5: Mutation measurements**

1. delete the skewed arm → three banner cases RED; 2. `warn = false` in `BuildLine.side` → the amber case RED; 3. return the line in local mode → the nothing case RED; 4. make the injected shape still call `api.fleetHealth` (drop the `pollMs <= 0` guard) → the "does not poll" case RED.

- [ ] **Step 6: Commit**

```bash
git add pwa/src/fleet/useFleetHealth.ts pwa/src/fleet/BuildLine.tsx pwa/src/fleet/FleetHostBanner.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/test/fleet-host-banner.test.tsx pwa/test/build-line.test.tsx
git commit -m "feat(pwa): the skewed-build banner names both versions; BuildLine shows what each box runs; one fleet-health poll feeds both"
```

---

### Task 8: The doctor — `_check_skills`, and `fleet`'s remedy names `rollout`

**Files:**
- Modify: `ccd/ccrc-doctor-checks` — `skills` in `CCRC_DOCTOR_CHECKS` (after `wrappers`), new `_check_skills`, the `fleet` check's skewed remedy.
- Modify: `server/test/ccrc-doctor.test.ts` — `installCcrc` plants the three shipped skill trees; `healthy()` plants the upstream home's installed copies; new `describe('ccrc doctor: skills'`; the `fleet` remedy pin.

**Interfaces:**
- Consumes: `~/.ccrc/accounts.json` (roster; `id`, `configDirSuffix`), `$BOX_TREE_DIR/ccd/{coordinator,worker,reviewer}-skill/` (the shipped tree), `$HOME/<configDirSuffix>/skills/ccrc-{coordinator,worker,reviewer}/` (the installed copies).
- Produces: `PASS|FAIL|WARN|SKIP skills: …` per the doctor contract.

- [ ] **Step 1: Write the failing tests**

In `server/test/ccrc-doctor.test.ts`:

(a) In `installCcrc`, after the three `symlinkSync` lines, add:

```ts
  // The three shipped skill trees (release/rollout design §6): `_check_skills`
  // compares every home's installed copy against THESE, the tree the stamp
  // names — not against the `.cc-sessions` placed copy, which was stale too
  // on 2026-09-17.
  for (const n of ['coordinator-skill', 'worker-skill', 'reviewer-skill']) {
    symlinkSync(join(REPO, 'ccd', n), join(ccd, n));
  }
```

(b) In `healthy()`, right after `writeRoster(home, [UPSTREAM]);`, add:

```ts
  // …and the upstream home carries the shipped skills, byte for byte —
  // `skills` is a check, and healthy()'s contract is that every check
  // PASSES. Copies, not symlinks: diff -r follows symlinks either way, but a
  // copy is what the installer actually leaves.
  for (const [tree, name] of [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer']] as const) {
    cpSync(join(REPO, 'ccd', tree), join(home, '.claude', 'skills', name), { recursive: true });
  }
```

(`cpSync` joins the `node:fs` import if absent.)

(c) A new describe, next to `ccrc doctor: wrappers`:

```ts
describe('ccrc doctor: skills — every home carries the SHIPPED skills (release/rollout design §6)', () => {
  const installed = (home: string, suffix: string, name: string): string => join(home, suffix, 'skills', name);

  it('passes on the healthy box, counting homes', () => {
    const home = healthy('ccrc-doctor-skills-pass-');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped ccrc-coordinator, ccrc-worker and ccrc-reviewer$/m);
  });

  it('fails on ONE edited byte in ONE home, naming the account and the skill, and the installer runs it green again', () => {
    const home = healthy('ccrc-doctor-skills-stale-');
    const f = join(installed(home, '.claude', 'ccrc-reviewer'), 'SKILL.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('$HOME/.cc-clips/', '$WT/.ccrc-review/'));   // the 2026-09-17 clause, put back
    let r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL skills: 1 installed skill\(s\) differ from the shipped tree: claude: ccrc-reviewer differs$/m);
    expect(r.stdout).toMatch(/remedy: run 'ccrc update'/);
    // The remedy works: the shipped installer converges the home.
    spawnSync(BASH, [join(REPO, 'ccd', 'install-reviewer-skill.sh'), '--homes', join(home, '.claude')],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: join(REPO, 'ccd', 'reviewer-skill') } });
    r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills:/m);
  });

  it('a missing skill directory is a FAIL in its own words', () => {
    const home = healthy('ccrc-doctor-skills-missing-');
    rmSync(installed(home, '.claude', 'ccrc-worker'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: .*claude: ccrc-worker missing/m);
  });

  it('a second rostered home is measured too, and its config dir comes from configDirSuffix', () => {
    const home = healthy('ccrc-doctor-skills-two-');
    writeBinary(home, 'acct-a');
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    mkdirSync(join(home, '.acct-a', 'skills'), { recursive: true });
    let r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: 3 installed skill\(s\) differ .*acct-a: ccrc-coordinator missing.*acct-a: ccrc-worker missing.*acct-a: ccrc-reviewer missing/m);
    for (const [tree, name] of [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer']] as const) {
      cpSync(join(REPO, 'ccd', tree), installed(home, '.acct-a', name), { recursive: true });
    }
    r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills: 2\/2 homes/m);
  });

  it('skips on a server-role box — it hosts no sessions', () => {
    const home = healthy('ccrc-doctor-skills-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', '']);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP skills: this box records CCRC_ROLE=server/m);
  });

  it('skips, never passes vacuously, when the roster names no home that exists on this box', () => {
    const home = healthy('ccrc-doctor-skills-nohome-');
    rmSync(join(home, '.claude'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP skills: none of the roster's config directories exist/m);
  });

  it('fails when the shipped tree itself lacks a skill — nothing says what "installed" should mean', () => {
    const home = healthy('ccrc-doctor-skills-notree-');
    rmSync(join(home, 'ccrc', 'ccd', 'reviewer-skill'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: the shipped tree has no .*reviewer-skill/m);
  });
});
```

(d) The `fleet` remedy pin — in `fails on a skewed build, and the remedy names the ORDER`, change the assertion line to:

```ts
    expect(r.stdout).toMatch(/remedy: run 'ccrc rollout' from the deploying machine.*or 'ccrc update' on the lagging box.*fleet box first/i);
```

(e) Read `HEALTHY_SKIPS`' neighbours: the table-is-data describe pins the check count from the sourced array (derived, not hand-written), so adding `skills` there needs no count edit — but grep the file for `'wrappers',` inside any hand-written ordered list of names and add `'skills'` after it if one exists.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "skills|remedy names the ORDER"` (foreground, ≥ 600000 ms).
Expected: the `skills` cases FAIL (no such check → `MISSING _check_skills` is not reported since the name is not in the table; the verdict lines are absent); the remedy pin FAILS on wording.

- [ ] **Step 3: Implement**

`ccd/ccrc-doctor-checks`: in `CCRC_DOCTOR_CHECKS=(…)`, add `  skills` on its own line directly after `  wrappers`. New function, placed after `_check_wrappers`:

```bash
# ── skills — every rostered home carries the SHIPPED skills ────────────────
# Release/rollout design §6. Compares each home's installed
# ccrc-coordinator/worker/reviewer against the TREE (`$BOX_TREE_DIR/ccd/
# <name>-skill`), the thing the build stamp names — not against the
# `.cc-sessions` placed copy: on 2026-09-17 both were stale while the tree
# on the box was current, and eighteen reviewers read an old clause. Homes
# come from `accounts.json` (`_check_credentials`' reader), so the check has
# a subject wherever `wrappers` does. graphify's skill has its own check —
# its source is the installed package, not this tree.
_check_skills() {
  local role=""
  [ -r "$BOX_ENV_FILE" ] && role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  if [ "$role" = server ]; then
    _dr_skip skills "this box records CCRC_ROLE=server, so it hosts no sessions and no account's skills directory is its concern"
    return 3
  fi
  local tree="$BOX_TREE_DIR/ccd" name
  for name in coordinator-skill worker-skill reviewer-skill; do
    if [ ! -d "$tree/$name" ]; then
      _dr_fail skills "the shipped tree has no $tree/$name, so nothing on this box says what the installed skills should be" \
        "run 'ccrc update' (or 'ccrc install' from a checkout) to place the shipped tree"
      return 1
    fi
  done
  if ! command -v diff >/dev/null 2>&1; then
    _dr_warn skills "diff is not on PATH, so the installed skills could not be compared with the shipped tree" \
      "install diffutils"
    return 2
  fi
  local roster="$HOME/.ccrc/accounts.json"
  if [ ! -f "$roster" ] || [ ! -r "$roster" ]; then
    _dr_skip skills "no readable account roster at \$HOME/.ccrc/accounts.json — the 'wrappers' check above owns that"
    return 3
  fi
  if ! command -v node >/dev/null 2>&1; then
    _dr_fail skills "node is not on PATH, so \$HOME/.ccrc/accounts.json cannot be read" "install Node first — see the 'node' check above"
    return 1
  fi
  local rows rc
  rows="$(CCRC_DOCTOR_ROSTER="$roster" node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.env.CCRC_DOCTOR_ROSTER, "utf8")); }
    catch (e) { process.exit(3); }
    if (!j || typeof j !== "object" || !Array.isArray(j.accounts)) process.exit(4);
    const ok = /^[a-z][a-z0-9-]{0,31}$/;
    const dir = /^\.[A-Za-z0-9._-]{1,64}$/;
    process.stdout.write(j.accounts
      .filter((a) => a && typeof a === "object" && ok.test(a.id) && typeof a.configDirSuffix === "string" && dir.test(a.configDirSuffix))
      .map((a) => a.id + "\t" + a.configDirSuffix).join("\n"));
  ' 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    _dr_skip skills "\$HOME/.ccrc/accounts.json could not be read as a roster — the 'wrappers' check above owns that"
    return 3
  fi
  local id suffix dir homes=0 n installed
  local -a stale=()
  while IFS=$'\t' read -r id suffix; do
    [ -n "$id" ] || continue
    dir="$HOME/$suffix"
    [ -d "$dir" ] || continue
    homes=$((homes + 1))
    for name in coordinator-skill worker-skill reviewer-skill; do
      installed="ccrc-${name%-skill}"
      if [ ! -d "$dir/skills/$installed" ]; then
        stale+=("$id: $installed missing"); continue
      fi
      diff -r -q "$tree/$name" "$dir/skills/$installed" >/dev/null 2>&1 || stale+=("$id: $installed differs")
    done
  done <<< "$rows"
  if [ "$homes" -eq 0 ]; then
    _dr_skip skills "none of the roster's config directories exist on this box, so there is no installed skill to compare"
    return 3
  fi
  if [ "${#stale[@]}" -eq 0 ]; then
    _dr_pass skills "$homes/$homes homes carry the shipped ccrc-coordinator, ccrc-worker and ccrc-reviewer"
    return 0
  fi
  _dr_fail skills "${#stale[@]} installed skill(s) differ from the shipped tree: $(_dr_join "${stale[@]}")" \
    "run 'ccrc update' — or, when 'ccrc version' already names the intended build, re-run the installers on this box: bash \$HOME/.cc-sessions/install-coordinator-skill.sh; bash \$HOME/.cc-sessions/install-worker-skill.sh; bash \$HOME/.cc-sessions/install-reviewer-skill.sh"
  return 1
}
```

(`_dr_join` exists in this file already — the shared verdict joiner.)

The `fleet` check's skewed remedy: replace the string that begins `"run 'ccrc update' on the lagging box — fleet box first, then the server box (stage 4, spec §8): …` with:

```bash
      "run 'ccrc rollout' from the deploying machine (release/rollout design §4), or 'ccrc update' on the lagging box — fleet box first, then the server box: the server reads what the fleet host's hook writes and the agent caches 'ccd caps' at boot, so the other order runs a server that reads fields the fleet host does not yet write. 'ccrc version' on each box names the sha it is running"
```

- [ ] **Step 4: Run to verify they pass**

Run the whole `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts` (foreground, ≥ 600000 ms) — the healthy fixture changed, so every summary-count case must still hold: the new check PASSES on `healthy()` and adds no skip, so `HEALTHY_SKIPS` is unchanged. Then `test/ccrc-doctor-graphify.test.ts` (its own `healthy()` may need the same two plantings if it asserts "every check passes"). Then `bash -n ccd/ccrc-doctor-checks`.

- [ ] **Step 5: Mutation measurements**

1. replace `diff -r -q …` with `[ -d "$dir/skills/$installed" ]` → the one-edited-byte case RED; 2. compare against `$HOME/.cc-sessions/$name` instead of the tree → keep the edited-byte case (still red? the placed copy is absent in the fixture, so the check would take a different arm — record what it does; the pin that matters is 1); 3. drop the `homes -eq 0` skip → the vacuous case RED; 4. delete `skills` from the table → the table-is-data `ORPHAN _check_skills` pin RED.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
git commit -m "feat(doctor): skills — every home measured against the shipped tree; fleet's skew remedy names rollout"
```

---

### Task 9: Docs in the same PR — CLAUDE.md, README (line-neutral), the spec's `state` vocabulary

**Files:**
- Modify: `CLAUDE.md` (the Deploy bullet under "Build / test / deploy"; the reviewer bullet's last sentence under "Coordination"), `README.md` (§"Releases — install from an artifact, update, uninstall" and §"Deploy"), `docs/superpowers/specs/2026-09-18-release-rollout-design.md` (§6 `--check` states gain `incomplete` — already applied when this plan was committed; verify).

- [ ] **Step 1: Measure the budget**

Run: `wc -l README.md` — record the number (3195 at planning time). Every README edit below replaces lines one-for-one; re-run after each and the count must be unchanged.

- [ ] **Step 2: CLAUDE.md — the Deploy bullet**

Replace the bullet that begins `- **Deploy** (mechanics in README "Deploy"): \`bash deploy/deploy.sh\` (server), \`bash deploy/deploy.sh agent <host>\`.` — the whole bullet through `…the server lane's final gate is \`/health\` reporting the shipped sha.` — with:

```markdown
- **Deploy = release + rollout** (design `docs/superpowers/specs/2026-09-18-release-rollout-design.md`). Every merge to
  `main` becomes a GitHub Release within about a minute (`.github/workflows/release-main.yml` → `deploy/release-main.sh`
  → `build-release.sh`; patch-per-merge, a hand-pushed `vX.Y.0` tag for a minor rides `release.yml`). Moving the fleet
  is ONE act from a machine with ssh to both boxes: `ccrc rollout [--to vX.Y.Z] [--server-first] [--check]` — it
  preflights each box's recorded `CCRC_ROLE`, pins the version from SHA256SUMS once, runs `ccrc update --to` on the
  fleet box then the server box, stops at the first failure, and re-measures both. Any single box is `ccrc update`;
  a converged box (stamp, staged sha and `~/.ccrc/installed` agreeing) is left alone — `--force` reinstalls. **What is
  running where:** `ccrc version` (with its `install:` line), `ccrc update --check`, `/health`'s `version`, the PWA's
  `BuildLine`, and doctor's `skills` check (every home vs the shipped tree). Coordinates live in `~/.ccrc/deploy.env`
  (`CCRC_BOX`, `CCRC_AGENT_BOX` — never defaulted from `CCRC_BOX` — `CCRC_SSH_KEY`, `CCRC_SSH_PORT`; real values:
  `deploy/reference-fleet.md`, gitignored). **`deploy/deploy.sh` is the FALLBACK, not the path:** it pushes a working
  tree, stamps no `version` (the PWA shows such a box amber as unversioned), ships skills on its agent arm only, and
  still refuses with exit 2 without a target. The ordering rule survives as `rollout`'s default: fleet box first
  because the server reads what the hook writes and the agent caches `ccd caps` at boot — `--server-first` when a
  wave's server arm is a reader-widening.
```

- [ ] **Step 3: CLAUDE.md — the reviewer bullet**

In the bullet beginning `- **So does the reviewer**`, append one sentence at its end: ` A skill reaches a home through \`ccrc update\`'s install spine (\`_inst_skills\`, every rostered home) — never assume a server-only deploy carried it; doctor's \`skills\` check measures every home against the shipped tree.`

- [ ] **Step 4: README §Releases — the pipeline paragraph, line-neutral**

Replace the sentence-run `**The pipeline.** Pushing a tag \`v*\` runs \`.github/workflows/release.yml\`, which is deliberately` … through `… the sha is the truth, the tag is the label).` (10 lines) with exactly 10 lines:

```markdown
**The pipeline.** Every push to `main` runs `.github/workflows/release-main.yml`, thin like its
sibling: `deploy/release-main.sh` derives the next patch tag from the highest `vX.Y.Z`, pushes it,
runs `deploy/build-release.sh` (the one builder — refuses a dirty tree and an untagged HEAD) and
publishes the tarball plus `SHA256SUMS` with `gh release create --verify-tag`, deleting the tag again
if the publish never completes. A hand-pushed `vX.Y.0`/`vX.0.0` tag rides `release.yml` instead and
the next merge derives past it. The tarball is the matched set — prebuilt dists, the three
`package.json`+lock pairs, `shared/`, `ccd/`, the deploy units and helpers, `install.sh` — with a
`MANIFEST` of per-file sha256 digests and a shipped `build.json` that carries the tag as `version`
(`ccrc version` prints it; `/health` emits a sibling `version`; `buildAgreement` still compares
sha+dirty only — the sha is the truth, the tag is the label). Design: `2026-09-18-release-rollout-design.md`.
```

- [ ] **Step 5: README §Releases — the Update paragraph, line-neutral**

Replace `**Update.** \`ccrc update [--to vX.Y.Z]\` — per box, explicit, never automatic, fleet-box-first` … through `its \`fleet\` check's skew remedies name \`ccrc update\`, fleet box first.` (15 lines) with exactly 15 lines:

```markdown
**Update and rollout.** `ccrc update [--to vX.Y.Z] [--check] [--force]` — per box, explicit, never
automatic. `--check` prints where this box stands against the published release (a fixed-shape
`check:` line, then a sentence; exit 0 only when current) and writes nothing. A box already running
the target whose install COMPLETED — stamp sha, staged sha and `~/.ccrc/installed` (the spine's last
write) all agreeing — is left alone; `--force` reinstalls. Otherwise the spine, each step refusing
loudly: fetch + verify (transport checksum, then the per-file `MANIFEST`); back up to
`~/ccrc-backups/<ts>/` (coord.db via `VACUUM INTO`, dists, ccd, units, `~/.ccrc/memory`) before any
install write; re-run the install spine from the staged tree (role-aware, atomic, seed-once files
untouched, every rostered home's skills converged); the supervisor sweep behind its mandatory
`KillMode=process` preflight; then the from→to report. Rolling back is `--to <the older tag>`, which
prints the coord.db restore commands rather than auto-restoring. **Across a two-box fleet, `ccrc
rollout [--to] [--server-first] [--check] [--force]`** from a machine holding `~/.ccrc/deploy.env`
does it in order — roles preflighted, version pinned once from SHA256SUMS, fleet box then server
box, stop on the first failure, both boxes re-measured. `ccrc doctor`'s `build` check compares the
running server against the stamp, `skills` every home against the shipped tree, `fleet` names `ccrc rollout`.
```

- [ ] **Step 6: README §Deploy — the opening, line-neutral**

Replace the five lines from `\`deploy/deploy.sh\` is a convenience wrapper for pushing a working tree onto a box` through `with exit 2 until it knows where it is going.` with exactly five lines:

```markdown
`deploy/deploy.sh` is the FALLBACK — it pushes a working tree onto a box that is
**already installed**, stamps no `version`, and ships skills on its agent arm
only. The path is a release (`release-main.yml`) and `ccrc rollout`; see
"Releases" above. It still has **no default target** and refuses with exit 2
until it knows where it is going, for the reason it always did.
```

- [ ] **Step 7: Verify and commit**

Run: `wc -l README.md` (unchanged); `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/reviewer-skill.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts` (the prose pins); and the identity scan the pre-push hook performs on every push to the public remote (it refuses on its own — never spell its literals in any tracked file, this plan included; `127.0.0.1` is the one address main already carries). Then:

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-09-18-release-rollout-design.md
git commit -m "docs: deploy is release + rollout — CLAUDE.md, README (line-neutral), spec state vocabulary"
```

---

### Task 10: The PR, the rehearsal, and the first live rollout (operator-gated)

- [ ] **Step 1: Full suites, foreground.** `cd server && npm run test` in six shards (`--shard=N/6`, timeout 600000 each, per the memory that the 320-file suite overruns one run), `cd agent && npm run test`, `cd pwa && npm run test`, three `npm run build`s, `bash -n ccd/ccrc ccd/ccrc-doctor-checks deploy/release-main.sh`. Re-run any red in isolation before calling it real.
- [ ] **Step 2: Deviation ledger.** For every departure from the spec taken during Tasks 1–9, mint numbers (`ccrc-api ledger …`, one block for this run) and define them in `## Deviations found` below in the same act. Run `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` after `git fetch origin main`.
- [ ] **Step 3: Open the PR** from `spec/release-rollout` with the spec's §0 as the body, the `blob/main` spec link plus the PR `/files` view, and the attribution trailer. Merge is `gh pr merge --squash --admin` with the derived `Co-authored-by` trailers (see the ledger rule in the deploy-topology memory).
- [ ] **Step 4: The auto-release fires on the merge.** Watch `gh run list --workflow=release-main.yml --limit 1`; expect `v0.0.2` at `gh release list`.
- [ ] **Step 5: Rehearsal (spec §7)** — the `ccrc-update.test.ts` FULL-flavour happy path is the harness; run it once by hand against the real artifact: a fixture HOME built by that file's `freshUpdateBox` + `plantOldBox` (write a 20-line script in the scratchpad that imports nothing from the test file but copies its stub bodies), `CCRC_RELEASE_BASE_URL` left at the GitHub default, `ccrc update --to v0.0.2`. It must end with `install: installed: <sha>` and `update: build: … -> v0.0.2 (<sha>)`. Then `install.sh --release v0.0.2` into a second fixture HOME (the contributor case).
- [ ] **Step 6: The live one — OPERATOR RUNS IT** (CLAUDE.md: the agent deploy is the operator's lane). From the deploying machine: `ccrc rollout --check` (both boxes print `unversioned (…)`), then `ccrc rollout`. Acceptance, measured: `rollout --check` names `v0.0.2` on both; `/api/fleet/health` answers `build: agreed` with both `builds` versioned; `ccrc doctor` on the fleet box says `PASS skills: N/N`; the PWA foot reads `fleet v0.0.2 · server v0.0.2`; a second `ccrc rollout` prints `nothing to do` and `systemctl --user show -p ActiveEnterTimestamp ccrc-agent.service` is unchanged across it.

---

## Mutation measurements

Fill one row per mutation listed in the tasks' Step 5s, measured, not predicted. `RED` = the named case failed with the mutation applied and passed with it reverted.

| Task | Mutation | Case | Result |
|---|---|---|---|
| 1 | dirty-tree refusal removed | refuses a dirty tree | RED (1/14 failed) — re-measured after R4: the fixture's `origin.git/hooks/update` now records every ref actually pushed, so "no push happened at all" is observable; see Deviations (D-3014, corrected) |
| 1 | tagged-HEAD short-circuit removed | already-tagged HEAD exits 0 | RED (1/14 failed) |
| 1 | `sort -V` → `sort` | `v1.9.11` derivation | RED (1/14 failed) |
| 1 | push moved below the build (gh and push statements swapped, both after the build) | pushes the tag BEFORE publishing | RED (1/14 failed) |
| 1 | `trap cleanup EXIT` removed | failed publish deletes the tag | RED (1/14 failed) |
| 1 | ls-remote origin-tag probe removed (R5) | refuses when origin already holds the derived tag | RED (1/14 failed) |
| 2 | `tags: ['v*']` added | triggers on main pushes only | RED (1/1 failed) |
| 2 | `npm ci` step added | owns no second build path | RED (1/1 failed) |
| 2 | `concurrency:` removed | serialises | RED (1/1 failed) |
| 2 | `timeout-minutes: 360` | oss-metadata deadline | RED (1/1 failed) |
| 3 | `_inst_installed` above `_inst_skills` | fault half of the install case | RED (1/1 failed) |
| 3 | uninstall `rm` removed | preserve-set case | RED (1/1 failed) |
| 3 | `cmd_version` compares `$rec == $rec` | `def456` sub-case | RED (1/1 failed) |
| 4 | version comparison dropped | different version never consults the record | RED (1/26 failed) |
| 4 | staged==box dropped | moved tag proceeds | RED (1/26 failed) |
| 4 | record comparison dropped | record absent / stale proceeds | RED (2/26 failed) |
| 4 | `--check` skips `_upd_resolve` | URL assertions | RED (4/26 failed) |
| 4 | gate below `_upd_backup` | skip case's no-backup assertion | RED (1/26 failed) |
| 5 | `--to` derived per box | pins the version first | |
| 5 | role preflight removed | role case | |
| 5 | stop-on-failure removed | box one fails → stop | |
| 5 | verify from update stdout | verification disagreeing | |
| 5 | `--check` early return removed | `--check` issues no update | |
| 6 | `builds:` line removed | both new skew cases | |
| 6 | `builds` emitted in local mode | local-mode pin | |
| 7 | skewed arm removed | three banner cases | |
| 7 | `warn = false` | amber case | |
| 7 | line rendered in local mode | nothing case | |
| 7 | `pollMs <= 0` guard removed | does-not-poll case | |
| 8 | `diff -r -q` → existence | one edited byte | |
| 8 | `homes -eq 0` skip removed | vacuous case | |
| 8 | `skills` removed from the table | ORPHAN pin | |

## Deviations found

(Numbers are ISSUED by the allocator at execution time and defined here in the same act — never spelled as a range, never chosen.)

- **D-3014** — Task 1's "dirty-tree refusal removed" mutation first measured GREEN, not RED, on the fixture as the brief specified it. With `release-main.sh`'s own `git status --porcelain` refusal deleted, the dirty-tree fixture case (`refuses a dirty tree`) still passed: the script proceeded far enough to tag and push `NEXT` to origin, then invoked `build-release.sh`, which carries the *identical* dirty-tree guard and dies with the same `refusing a dirty tree` message on stderr before touching `npm`. `release-main.sh`'s own `trap cleanup EXIT` then fired (because `PUBLISHED` never reached `true`) and deleted the tag it had just pushed — so `originTags(home)`, the absence of `npm-argv`, and the absence of `gh-argv` all landed exactly where the test expected, by coincidence rather than because `release-main.sh`'s own refusal fired. `build-release.sh`'s guard was shadowing `release-main.sh`'s one step later, and the fixture as first written could not see the difference.
  This was closed by a controller ruling (fix round 1): the fixture's `origin.git` gained an executable `hooks/update` that records every ref actually reaching origin to `$HOME/origin-pushes`, independent of whether that ref is later deleted by cleanup — so a *transient* push, tagged and then unwound, is now distinguishable from no push at all. The dirty-tree case now asserts `origin-pushes` does not exist (no push, transient or otherwise), and the happy-path derivation cases assert it contains exactly one line, the pushed tag. Re-measured with that stronger fixture: deleting the `git status --porcelain` refusal now goes **RED** (1/14 failed) — the dirty-tree case fails because a push *did* reach origin (and was then cleaned up), which the strengthened assertion now catches. The first draft's claim that this was unobservable from outside the process was wrong; a git hook, not the process's own exit state, makes it observable. See the mutation table above (Task 1, "dirty-tree refusal removed") for the corrected result. The number D-3014 is kept for this entry (an issued number is never orphaned) even though its text now records the shadowing's closure rather than an open gap.
- **D-3015** — R5 (controller, fix round 1): added a destructive-path guard in `release-main.sh` — before `git tag "$NEXT"`, probe origin with `git ls-remote --exit-code --tags origin "refs/tags/$NEXT"` and refuse if it already exists. Without this, a tag-stale checkout (local tags behind origin's) lets `git tag` succeed locally, the subsequent push become a silent no-op, and — on a failed publish — the cleanup trap delete a PRE-EXISTING tag that has a real release behind it. This is new script behavior beyond the brief's original text, so it is its own deviation rather than folded into D-3014 (which is about the dirty-tree test's observability, not about tag staleness). Covered by a new test (`refuses when origin already holds the derived tag`) and mutation row 6 (`ls-remote origin-tag probe removed` → RED, 1/14 failed).
- **D-3016** — Task 2 (fix round 1): the brief's own Step 3 YAML draft for `.github/workflows/release-main.yml` failed the pins its own Step 1 defines — the top-of-file comment named `build-release.sh` (matching `/build-release\.sh/` in the "owns no second build path" pin), the `permissions:` comment named `gh release create` (matching `/gh release/` in the "owns no second... publish path" pin), and an explanatory comment sat between `permissions:` and `contents: write` (breaking the `/^    permissions:\n      contents: write$/m` anchor). The implementer reworded those three comments only — no trigger, concurrency, permissions value, step, or env line changed — and shipped the corrected wording, but the plan's own Step 3 fence above (this file) still carried the original three constructs, so anyone re-executing or citing Task 2 from the plan would ship a file that reds three of the five new cases. Closed in fix round 1 by editing the Step 3 fence above to match the shipped, passing `.github/workflows/release-main.yml` byte-for-byte (verified via `diff`), and by minting this number. Not a spec departure (the spec does not dictate comment wording) — the departure is from the brief's literal draft text only.
- **D-3017** — Task 3: adding `_inst_installed` to `cmd_install`'s spine broke a pre-existing pinned test, `'ccrc install: the order is stated in one place' > 'cmd_install is the sequence, and the roster precedes the ccd it installs'` (`server/test/ccrc-install.test.ts`), which asserts the exact step sequence with `.toEqual([...])`. The brief did not mention this pin. Closed by appending `'_inst_installed'` to that array (with a one-line comment explaining why it is last), the smallest faithful fix that keeps the pin accurate rather than leaving it stale/red; the pin's own load-bearing ordering (deploy.sh's "roster before ccd") is otherwise untouched. Originally recorded as `D-TBD-spine-order-pin` on the (false) premise that `~/.local/bin/ccrc-api` was unreachable from the implementer's sandbox — a fix-round re-check from this worktree found the allocator reachable (`ledger list` returned `{"ok":true,"floor":3017,...}`), so this number was minted for real rather than left as a placeholder.
- **D-3018** — Task 3: the brief's own test snippet for `server/test/ccrc-cli.test.ts` (the `install: complete` case) calls `rmSync(join(home, '.ccrc', 'build.json'))`, but that file did not import `rmSync` from `node:fs` before this task. Not a design departure — a missing import the brief's snippet silently assumed — closed by adding `rmSync` to the file's existing `node:fs` import line. Originally recorded as `D-TBD-cli-rmsync-import` on the same false unreachable-allocator premise as D-3017; minted for real in this fix round once the allocator was confirmed reachable.
- **D-3019** — Task 4: splitting `_upd_fetch` into `_upd_resolve`/`_upd_fetch` renamed the local `tarname` to the file-scope `UPD_TARNAME`, per the brief's own instruction ("`tarname`→`UPD_TARNAME` ... no longer `local`"). `server/test/runbook-holds.test.ts`'s `"ccrc update"'s verified line is derived from _upd_fetch's template` pin quoted the OLD source line verbatim (`echo "update: verified $tarname …"`) and went red once the rename landed — a pre-existing pin the brief did not mention, exactly the shape of D-3017/D-3018. Closed by updating that one pin's quoted template to `$UPD_TARNAME`, matching the shipped source; the runbook's own rendered line (a literal tarball name, not the variable) is unchanged, so nothing about the worked-example output moved.
