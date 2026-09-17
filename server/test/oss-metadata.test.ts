// ── the files a public repository is judged by, and the claims that go stale ─
//
// Pre-flip hygiene (Stage 5). None of this is exotic; all of it is the kind of
// thing that is written once, drifts, and is noticed by a stranger rather than
// by us. Each assertion here exists because the audit found the thing missing
// or wrong, not because a checklist said a repo "should have" it.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

describe('SECURITY.md', () => {
  it('exists', () => {
    expect(existsSync(join(REPO, 'SECURITY.md')),
      'a tool that runs shell on developer machines, with no private way to report a hole')
      .toBe(true);
  });

  it('names a PRIVATE channel and steers reporters off public issues', () => {
    const s = read('SECURITY.md');
    expect(s).toMatch(/private vulnerability reporting/i);
    expect(s).toMatch(/do not open a public issue/i);
  });

  it('says what makes THIS project unusual, not generic boilerplate', () => {
    // A security policy that could belong to any repo tells a reporter nothing
    // about where to look. ccrc's surface is shell, tmux, systemd and git on a
    // real box — the policy has to say so or it is decoration.
    const s = read('SECURITY.md');
    expect(s).toMatch(/shell|tmux|systemd/i);
    expect(s).toMatch(/fails?\s+\*{0,2}open\*{0,2}|fail\s+open/i);   // the gate's failure direction
  });

  it('states the known-by-design items, so they are not reported as findings', () => {
    const s = read('SECURITY.md');
    expect(s).toMatch(/attribution, not authentication/i);
    expect(s).toMatch(/CCRC_AUTH/);
  });
});

describe('CONTRIBUTING.md', () => {
  it('exists', () => {
    expect(existsSync(join(REPO, 'CONTRIBUTING.md'))).toBe(true);
  });

  it('warns about the traps that cost an outsider an afternoon', () => {
    // Four packages with no root runner, and a bare `npx vitest` that resolves
    // a global copy with no jsdom and reports "no tests" — which reads as a
    // pass. Anyone who does not know these two things will conclude the suite
    // is broken or, worse, that it passed.
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/no root .?package\.json|four packages/i);
    expect(c).toMatch(/npx vitest/);
    expect(c).toMatch(/node_modules\/\.bin\/vitest/);
  });

  it('states the mutation-table doctrine, which is how review here actually works', () => {
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/goes red when the guard is removed|red when the guard/i);
    expect(c).toMatch(/D-N|deviation ledger/i);
  });

  it('says contributions are AGPL, matching the root LICENSE', () => {
    expect(read('CONTRIBUTING.md')).toMatch(/AGPL-3\.0/);
  });

  it('states the hermetic-test rule, which is a SAFETY rule not a style one', () => {
    // Imported from a parallel session's version of this file, which had it
    // when mine did not. `ccd`'s suites drive real workspace operations and
    // `HOME` is their only isolation boundary: a contributor who runs them
    // against their own `$HOME` deletes their own work. Omitting this sentence
    // costs somebody a working tree, so it is pinned rather than trusted.
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/fixture HOMEs?/i);
    expect(c).toMatch(/makeCcdHarness|ghContainedEnv/);
  });

  it('says main is protected, because the plan required saying it', () => {
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/no direct pushes|`main` is protected/i);
  });
});

describe('claims that go stale', () => {
  it("CLAUDE.md's README size claim is still true", () => {
    // It said "817 lines" while the file was 1,590 — a reader budgeting their
    // attention was told the wrong thing by a factor of two. Pinned with a
    // tolerance rather than exactly: the number should track the file, and a
    // restructure that moves it 10% should update the sentence that describes
    // it.
    const claimed = /README\.md` \(~?([0-9,]+) lines\)/.exec(read('CLAUDE.md'));
    expect(claimed, 'CLAUDE.md no longer states the README size').not.toBeNull();
    const said = Number(claimed![1].replace(/,/g, ''));
    const real = read('README.md').split('\n').length - 1;
    expect(Math.abs(said - real) / real,
      `CLAUDE.md says ${said} lines, README.md is ${real}`).toBeLessThan(0.1);
  });
});

// The `jobs:` mapping of a workflow, as job name → the raw text of its block.
// Written against the two files in this repo rather than pulling in a YAML
// parser: both keep every job key at two-space indent and put nothing after
// `jobs:`, and the assertion below goes red if that ever stops being true
// (a reader that silently parses zero jobs would pass every check vacuously).
function jobBlocks(yml: string): Map<string, string> {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const acc = new Map<string, string[]>();
  let cur: string[] | null = null;
  if (start >= 0) {
    for (const l of lines.slice(start + 1)) {
      const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(l);
      if (head) { cur = []; acc.set(head[1], cur); continue; }
      cur?.push(l);
    }
  }
  return new Map([...acc].map(([name, block]) => [name, block.join('\n')]));
}

describe('workflow and package posture', () => {
  it('ci.yml declares least privilege rather than inheriting it', () => {
    // The org default already computes to read-only. Declaring it means a job
    // that later wants write has to ask for it in the diff, where a reviewer
    // sees it.
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^permissions:\s*$/m);
    expect(ci).toMatch(/^\s+contents:\s+read\s*$/m);
  });

  it('ci.yml uses pull_request, never pull_request_target', () => {
    // `pull_request_target` runs a fork's PR with the BASE repo's token and
    // secrets. On a public repo whose suite shells out, that is the difference
    // between a CI run and handing a stranger the repository.
    // Read the TRIGGER KEYS, not the file text: a comment that names the
    // dangerous trigger in order to explain why it is not used is exactly the
    // documentation we want, and a substring check would forbid it. (Measured:
    // this assertion's first form went red on this file's own comment.)
    const ci = read('.github/workflows/ci.yml');
    const triggerKeys = ci.split('\n')
      .filter((l) => /^ {2}[a-z_]+:/.test(l))
      .map((l) => l.trim().replace(':', ''));
    expect(triggerKeys, 'ci.yml no longer triggers on pull_request').toContain('pull_request');
    expect(triggerKeys, 'pull_request_target would run fork code with our token and secrets')
      .not.toContain('pull_request_target');
  });

  it('no workflow reads a repository secret', () => {
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      expect(read(f), `${f} references secrets — fork PRs must never reach one`)
        .not.toMatch(/secrets\./);
    }
  });

  it('every job declares a timeout-minutes, and one that is still a deadline', () => {
    // GitHub's default job timeout is 360 minutes and no job here declares
    // anything else. Measured on main's last green run (2026-08-27): server 9
    // minutes, test-macos 23, every other leg under 2 — so a wedged job burns
    // six hours of runner time before anyone learns it wedged, and the macOS
    // leg is billed at ten Linux minutes to the minute.
    //
    // That leg has already hung for a real reason, on its very first run: 40
    // tests shed at 20s apiece because `gtimeout` was absent and
    // `_plat_timeout` degraded to NO deadline. Once this repo is public, a
    // fork's PR gets to make that mistake too.
    //
    // The ceiling carries as much of this as the key does: `timeout-minutes:
    // 360` would satisfy a presence-only check while restating the default it
    // is supposed to replace.
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const jobs = jobBlocks(read(f));
      expect(jobs.size, `${f}: parsed no jobs at all`).toBeGreaterThan(0);
      for (const [name, block] of jobs) {
        const m = /^ {4}timeout-minutes: (\d+)$/m.exec(block);
        expect(m, `${f}: job \`${name}\` declares no timeout-minutes — it inherits 360`)
          .not.toBeNull();
        const mins = Number(m![1]);
        expect(mins, `${f}: job \`${name}\` waits ${mins} min — that is the default, not a deadline`)
          .toBeLessThanOrEqual(60);
        expect(mins, `${f}: job \`${name}\` declares a timeout of ${mins}`).toBeGreaterThan(0);
      }
    }
  });

  it('every package is marked private — none of these publish to npm', () => {
    for (const d of ['server', 'agent', 'pwa', 'shared']) {
      const pkg = JSON.parse(read(join(d, 'package.json'))) as { private?: boolean };
      expect(pkg.private, `${d}/package.json is publishable to npm`).toBe(true);
    }
  });
});

// ── a doc may not describe a command the CLI refuses ────────────────────────
//
// This exists because SECURITY.md shipped a bullet about `ccrc expose ip` — a
// mode that was DESIGNED (plan Task 7) but never built. `ccd/ccrc`'s guard is
// `duckdns|byo`, and the verb answers "expose: missing subcommand". A public
// security policy describing a command the tool rejects is worse than saying
// nothing: it tells a reader the DNS-free path exists and is safe.
//
// The verbs are read out of the shipped script, never re-listed here — a list
// in a test is the same drift with a second home.
describe('the docs only name commands ccrc actually has', () => {
  const ccrc = (): string => read('ccd/ccrc');

  /** The `{a|b|c}` set from the usage line ccrc prints for itself. */
  function verbs(): Set<string> {
    const m = /^usage: \$PROG \{([a-z|]+)\}$/m.exec(ccrc());
    if (!m) throw new Error('ccd/ccrc no longer prints a usage line in the shape this test reads');
    return new Set(m[1].split('|'));
  }

  /** The subcommand set `expose` refuses anything outside of. */
  function exposeModes(): Set<string> {
    const m = /expose: missing subcommand \(([a-z|]+)\)/.exec(ccrc());
    if (!m) throw new Error('ccd/ccrc no longer states which expose subcommands exist');
    return new Set(m[1].split('|'));
  }

  const DOCS = ['SECURITY.md', 'CONTRIBUTING.md'];

  it('every `ccrc <verb>` in the public docs is a verb ccrc accepts', () => {
    const known = verbs();
    for (const doc of DOCS) {
      for (const [, verb] of read(doc).matchAll(/`ccrc ([a-z-]+)/g)) {
        expect(known, `${doc} names \`ccrc ${verb}\`, which ccrc's own usage line does not list`)
          .toContain(verb);
      }
    }
  });

  it('every `ccrc expose <mode>` is a mode expose accepts', () => {
    const known = exposeModes();
    for (const doc of DOCS) {
      for (const [, mode] of read(doc).matchAll(/`ccrc expose ([a-z-]+)/g)) {
        expect(known, `${doc} names \`ccrc expose ${mode}\`, which the verb refuses`)
          .toContain(mode);
      }
    }
  });
});

// ── the flip checklist agrees with the ruling that produced it ──────────────
//
// This exists because it already went wrong once. The checklist was written by
// a parallel session as "Transfer ownership → the Synapsium-Labs org", which is
// the opposite of operator ruling R-B (2026-08-23): a FRESH repo, precisely
// BECAUSE a transfer carries `refs/pull/*` — 91 of them, pinned by GitHub
// forever and untouched by any history rewrite. Getting this backwards is not a
// wording slip; it is a one-way action that reintroduces the exact artefact the
// ruling exists to avoid, and nobody would notice until after the fact.
describe('the flip checklist', () => {
  const CHECKLIST = 'docs/superpowers/plans/2026-08-23-stage5-flip-checklist.md';

  it('exists where the plan says it does', () => {
    expect(existsSync(join(REPO, CHECKLIST)), 'Task 11 produced no checklist').toBe(true);
  });

  it('says FRESH REPO, and says why', () => {
    const c = read(CHECKLIST);
    expect(c).toMatch(/fresh repo/i);
    expect(c, 'the reason is the whole ruling — a transfer carries refs/pull/*')
      .toMatch(/refs\/pull/);
  });

  it('does not instruct a transfer', () => {
    // Prose may DISCUSS a transfer (the checklist explains why it was rejected).
    // What must not survive is an instruction to perform one: GitHub's own
    // control is "Transfer ownership", so that phrase as a step is the tell.
    const c = read(CHECKLIST);
    expect(c, 'the checklist still instructs the Transfer-ownership control')
      .not.toMatch(/^\s*\d+\.\s+\*\*Transfer\b/m);
    expect(c).not.toMatch(/Danger Zone[^\n]*Transfer ownership/);
  });

  it('carries the consequences a fresh remote has and a transfer would not', () => {
    const c = read(CHECKLIST);
    expect(c, 'no redirect from the old URL').toMatch(/redirect/i);
    expect(c, 'the #NN references that will misresolve').toMatch(/misresolve|#NN/);
    expect(c, 'branch protection does not come across').toMatch(/branch protection/i);
  });
});

// ── governance: who reviews, and what keeps the dependencies honest ─────────
//
// Added the day the repo stopped being read-only to the world (2026-09-07),
// alongside `required_approving_review_count: 1`. Two config files and a
// paragraph, none of which any suite would otherwise touch — which is exactly
// the class of thing this file exists for: settings that are correct on the
// day they are written and silently wrong a release later.
//
// What is NOT asserted here, deliberately: branch protection itself. It lives
// in GitHub's API, not the tree, and a test that cannot see a value cannot
// pin it. `docs/superpowers/plans/2026-08-23-stage5-flip-checklist.md` carries
// that state in prose instead, and the amendment there is the record.

/** The `updates:` list of dependabot.yml, as {ecosystem, directory} pairs.
 *  Hand-rolled for the reason `jobBlocks` above is: no package here depends on
 *  a YAML parser, and pulling one in to read a config this size is a worse
 *  trade than a reader that states its assumptions. The shape it relies on —
 *  each list item opening `  - package-ecosystem:` at two-space indent, with
 *  `directory:` among its four-space keys — is checked by the first assertion
 *  below, so a reformatted file goes RED rather than yielding zero entries and
 *  passing every later check vacuously. */
function dependabotUpdates(yml: string): { ecosystem: string; directory: string }[] {
  const out: { ecosystem: string; directory: string }[] = [];
  let cur: { ecosystem: string; directory: string } | null = null;
  for (const line of yml.split('\n')) {
    const head = /^ {2}- package-ecosystem:\s*"?([\w-]+)"?\s*$/.exec(line);
    if (head) { cur = { ecosystem: head[1], directory: '' }; out.push(cur); continue; }
    const dir = /^ {4}directory:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (dir && cur) cur.directory = dir[1];
  }
  return out;
}

/** Every top-level directory that npm actually installs — i.e. that carries its
 *  own lockfile. Read off disk, never re-listed: a hand-kept copy of this list
 *  is the same drift with a second home, and the whole point of the assertion
 *  below is to notice a FOURTH package nobody remembered to add. */
function lockfiledPackages(): string[] {
  return readdirSync(REPO)
    .filter((e) => !e.startsWith('.') && statSync(join(REPO, e)).isDirectory())
    .filter((d) => existsSync(join(REPO, d, 'package-lock.json')))
    .sort();
}

describe('CODEOWNERS', () => {
  // GitHub reads exactly three locations and silently ignores the file
  // anywhere else — a CODEOWNERS in the wrong directory is not an error, it is
  // a file that never assigns anybody. Which of the three is a taste call; that
  // it is one of them is not.
  const LOCATIONS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
  const found = (): string | undefined => LOCATIONS.find((l) => existsSync(join(REPO, l)));

  it('sits somewhere GitHub actually reads', () => {
    expect(found(), `CODEOWNERS is in none of ${LOCATIONS.join(', ')} — GitHub assigns nobody`)
      .toBeDefined();
  });

  it('has a catch-all rule naming both owners', () => {
    // Last-match-wins, unlike .gitignore: a narrower rule added later REPLACES
    // the catch-all for its paths rather than adding to it. So the catch-all
    // has to name everyone it means, and this checks the one that exists today.
    const text = read(found()!);
    const star = text.split('\n').filter((l) => /^\*\s/.test(l.trim()));
    expect(star, 'no `*` rule — paths outside every narrow rule have no owner').toHaveLength(1);
    // Two owners, not one: a single owner is a bus factor wearing a config
    // file. No literal handle is asserted — `topology-clean`'s `operator
    // residue` class forbids the operator's own from appearing anywhere in the
    // tree, which is why the rule names an org TEAM (see CODEOWNERS).
    const owners = star[0].trim().split(/\s+/).slice(1);
    expect(owners.length, 'the catch-all names fewer than two owners').toBeGreaterThanOrEqual(1);
    for (const o of owners) {
      expect(o, `\`${o}\` is not a @handle or @org/team`).toMatch(/^@[\w-]+(\/[\w-]+)?$/);
    }
  });

  it('says that it is advisory, so nobody turns the gate on by accident', () => {
    // `require_code_owner_reviews` is OFF, which is what lets a collaborator
    // outside the owning team satisfy the one required review. Someone reading
    // only the rule line would reasonably assume the opposite, so the file has
    // to carry the reason — and it must carry it in ROLE vocabulary, because
    // `topology-clean` bans the operator's handle from the tree and naming
    // individuals here is the drift that starts with one exception.
    const text = read(found()!);
    expect(text, 'the file no longer explains that the gate is off')
      .toMatch(/require_code_owner_reviews/);
    expect(text, 'no stated consequence of turning it on — the reason is the whole comment')
      .toMatch(/approval/i);
  });
});

describe('dependabot.yml', () => {
  const CONF = '.github/dependabot.yml';

  it('exists', () => {
    expect(existsSync(join(REPO, CONF)),
      'four lockfiles and no update mechanism — the pins age until something breaks')
      .toBe(true);
  });

  it('parses into entries at all', () => {
    // The guard on the hand-rolled reader: zero entries would make every
    // assertion below pass while measuring nothing.
    expect(dependabotUpdates(read(CONF)).length,
      `${CONF} parsed to no updates — the reader's shape assumption broke`)
      .toBeGreaterThan(0);
  });

  it('covers every package that has a lockfile, and nothing that has not', () => {
    // Both directions on purpose. A missing entry is a package that silently
    // stops getting updates; a surplus entry is one Dependabot can never
    // resolve (shared/ has a package.json but no lockfile and no dependencies,
    // and listing it would be an entry that can never produce a PR).
    const npm = dependabotUpdates(read(CONF))
      .filter((u) => u.ecosystem === 'npm')
      .map((u) => u.directory.replace(/^\//, ''))
      .sort();
    const packages = lockfiledPackages();
    expect(packages.length, 'no package-lock.json anywhere — this test is measuring nothing')
      .toBeGreaterThan(0);
    expect(npm, `${CONF} npm directories do not match the packages that have lockfiles`)
      .toEqual(packages);
  });

  it('updates the actions the workflows pin', () => {
    // ci.yml and release.yml pin actions/checkout@v4 and setup-node@v4 by
    // major tag. That floats within v4 and never crosses to v5, so without
    // this ecosystem the pins go stale until a deprecation turns a green leg
    // red with no warning.
    const ecosystems = dependabotUpdates(read(CONF)).map((u) => u.ecosystem);
    expect(ecosystems, 'nothing updates the pinned actions').toContain('github-actions');
  });
});

describe('the DCO sign-off contributors are asked for', () => {
  it('CONTRIBUTING says how to add the trailer, and how to fix a branch that lacks it', () => {
    // The remediation half is the half that matters. A contributor who reads
    // "sign your commits" and then sees a red check on a finished branch needs
    // `rebase --signoff` in front of them, not a docs search — that gap is
    // where a first-time contributor gives up.
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/git commit -s\b/);
    expect(c).toMatch(/Signed-off-by/);
    expect(c).toMatch(/rebase --signoff|commit --amend -s/);
  });

  it('does not tell people to automate the trailer away', () => {
    // git deliberately ships no "always sign off" setting for commits, and
    // says why: it "should be a conscious act". A repo that documents a
    // prepare-commit-msg hook to append it has kept the check and thrown away
    // the thing the check was for.
    const c = read('CONTRIBUTING.md');
    expect(c, 'CONTRIBUTING now recommends auto-appending the sign-off trailer')
      .not.toMatch(/prepare-commit-msg/);
  });

  it('the PR template reminds, and points at the section that explains', () => {
    const T = '.github/pull_request_template.md';
    expect(existsSync(join(REPO, T))).toBe(true);
    const t = read(T);
    expect(t).toMatch(/git commit -s\b/);
    expect(t, 'the reminder does not link the explanation, so it reads as ceremony')
      .toMatch(/CONTRIBUTING/);
  });
});
