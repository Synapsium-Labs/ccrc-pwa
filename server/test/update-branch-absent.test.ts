// `update-branch` is ABSENT from executable source (landing-order spec
// 2026-09-23 §5.1, "Pins"). GitHub's update-branch pushes a merge of main onto
// a PR's head from the REMOTE side: it restarts CI, it is not a clean-merge
// proof anyone measured, and it breaks the workspace↔PR binding (`is_ours`
// binds a PR by ancestry from the workspace's LOCAL tip, so a remote-made
// descendant rebinds the sweep to an older PR and the close refuses
// `pr-regressed` — run 47, 2026-09-16). 183 of them landed in one 55.7-hour
// window. No executable path in this tree may ever issue one.
//
// A LITERAL pin, deliberately: it reds on the spelling in any form the fleet
// could run — `gh pr update-branch`, the REST path's `/update-branch`, the
// GraphQL `updatePullRequestBranch`, and `allow_update_branch`, the repository
// setting a script could flip (the pattern takes `-` or `_`, any case). It
// cannot see a spelling assembled at run time from fragments; nothing here
// claims it can. Comments count too: a comment is where the next author copies
// a command from.
//
// TWO SPELLINGS ARE LICENSED, and pinned LINE FOR LINE as the only ones —
// neither calls anything: the advisory's DETECTOR in `ccd/session-hook.sh`
// (the regex that recognises the call, and the prefilter glob in front of it),
// and the CLASSIFIER in the read-only instrument `deploy/measure-landing.py`
// (the label it gives a past GitHub-made merge, and the regex that finds one
// in a transcript). EQUALITY, not a ceiling: a new mention anywhere in the set
// reds, a changed detector or classifier line reds, and a licensed line that
// disappeared reds too — the licence names what the file must still carry.
//
// THE SKILLS ARE THE OTHER HALF, and there the word is COUNTED, not absent:
// worker clause 16 and coordinator clause 15 each name it once, to forbid it
// (`worker-skill.test.ts`, `coordinator-skill.test.ts`).
//
// THE SET IS THE SPEC'S, DERIVED from the index, never a hand-kept list of
// files: every tracked file under `server/src`, `agent/src`, `shared/` and
// `deploy/`, `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, and every
// `ccd/ccd-*` sibling tracked today or tomorrow. TRACKED, because `deploy/`
// also holds gitignored files a checkout makes — `__pycache__/` bytecode that
// loading the instrument as a module writes, the box's mail token — which are
// not source and must not be read. The corpus is its own control: a pathspec
// that silently stopped matching would make the absence vacuous, so it carries
// a floor and named members.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FORBIDDEN = /update[-_]branch|updatePullRequestBranch/i;

/** The executable-source set spec §5.1 names, derived from the index. */
const executableSource = (): string[] => {
  const r = spawnSync('git', ['ls-files', '-z', '--', 'server/src', 'agent/src', 'shared', 'deploy',
    'ccd/ccd', 'ccd/ccrc', 'ccd/session-hook.sh', 'ccd/ccd-*'], { cwd: root, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split('\0').filter((f) => f !== '').sort();
};

/** The two licensed spellings, line for line. A change to either line is a
 *  change to this licence, made in the same commit, on purpose. */
const LICENSED: Record<string, string[]> = {
  'ccd/session-hook.sh': [
    "LANDING_UB_RE='gh[[:space:]]+pr[[:space:]]+update-branch|/update-branch([^A-Za-z0-9_-]|$)|updatePullRequestBranch'",
    '         || "$payload" == *update-branch* || "$payload" == *updatePullRequestBranch* ]]; then',
  ],
  'deploy/measure-landing.py': [
    "GH_UPDATE = 'update-branch'",
    'UPD = re.compile(r"gh\\s+pr\\s+update-branch|/update-branch\\b")',
  ],
};

describe('update-branch is absent from executable source (landing-order spec §5.1)', () => {
  it('the derived set is its own control — a floor and named members', () => {
    const set = executableSource();
    expect(set.length, 'the pathspec found almost nothing — the absence below would be vacuous')
      .toBeGreaterThanOrEqual(150);
    for (const f of ['ccd/ccd', 'ccd/ccrc', 'ccd/session-hook.sh', 'ccd/ccd-pool-sync', 'ccd/ccd-tmp-sweep',
      'server/src/coord/routes.ts', 'agent/src/whitelist.ts', 'shared/api.ts', 'shared/mark.mjs',
      'deploy/deploy.sh', 'deploy/measure-landing.py']) {
      expect(set, `${f} is executable source and must be scanned`).toContain(f);
    }
  });

  it('spells update-branch only in the two licensed lines — the detector and the classifier', () => {
    const found: Record<string, string[]> = {};
    for (const f of executableSource()) {
      const lines = readFileSync(path.join(root, f), 'utf8').split('\n').filter((l) => FORBIDDEN.test(l));
      if (lines.length > 0) found[f] = lines;
    }
    expect(found, 'executable source names update-branch outside its two licensed spellings; the fleet never issues one')
      .toEqual(LICENSED);
  });
});
