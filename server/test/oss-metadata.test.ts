// ── the files a public repository is judged by, and the claims that go stale ─
//
// Pre-flip hygiene (Stage 5). None of this is exotic; all of it is the kind of
// thing that is written once, drifts, and is noticed by a stranger rather than
// by us. Each assertion here exists because the audit found the thing missing
// or wrong, not because a checklist said a repo "should have" it.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
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
