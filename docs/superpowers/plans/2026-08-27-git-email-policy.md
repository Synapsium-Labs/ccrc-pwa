# `git_email` tells a policy from an absence — record

> Not a plan: a one-check change made directly, recorded here because it carries
> ledgered deviations and a decision worth keeping.

**Goal:** `ccrc doctor`'s `git_email` check stops calling a deliberate
per-repository identity policy a failure.

**Tech Stack:** bash (`ccd/ccrc-doctor-checks`), vitest.

## What was measured (2026-08-26/27, the fleet box)

- `~/.gitconfig` exists but sets no `user.email` and no `user.name` — only
  credential helpers, a `url.insteadOf`, and LFS filters. Nothing at system level.
- **All 20 repositories ccd knows about set their own identity. Zero missing.**
- **Three distinct identities are in deliberate use** across those 20: a GitHub
  noreply (11), a work address (7), a personal address (2).
- `ccd ws-add` uses `git worktree add`, never `git clone`, so a new workspace
  INHERITS its parent's identity. That is why the fleet never hit this despite
  the check failing for months.
- git 2.43 in a fresh repo with no identity refuses with `Author identity
  unknown` and commits nothing. It does not guess from `user@host`. **The
  current state is fail-safe.**

## The decision, and why it is not "set a global address"

A global default does not clear a risk here, it creates a worse-shaped one. With
three identities in use, a global silently attributes a commit to the wrong
address whenever a repository forgets its own — and a wrong author is permanent
in history, where a refusal is loud and fixable.

`user.useConfigOnly=true` is git's own way to SAY "identity is per-repository":
git then refuses to invent one and demands an explicit address in each repo.
That is the posture this box already has; it simply had no way to declare it.

## Deviations found

_(allocated from `POST /api/ledger/deviations` — D-893..D-894, floor 895)_

- **D-893** — `_check_git_email` read `user.email` alone and called empty a
  failure, which collapsed two states an operator handles completely
  differently: **absent by policy** (identity is per-repository, deliberately)
  and **never configured** (the box was simply never told). That is the
  overloaded-null-at-a-seam shape this tree bans by name, in a check whose whole
  job is to report a box's posture. The check now reads
  `user.useConfigOnly` and PASSES on `true` with a sentence naming the policy;
  it FAILS only when there is neither an identity nor a declaration, and its
  remedy now names BOTH postures — the old remedy named a global address and
  nothing else, pointing an operator whose identity is deliberately per-repo at
  the one change that would make their commits wrong.
  Precedence is address-then-policy, and that is pinned: a box carrying both is
  reported by its address.
- **D-894** — the consequence that makes this more than a yellow line:
  **`cmd_install` ends with `cmd_doctor` (`ccd/ccrc:3003`) and the function
  closes on the next line, so bash returns doctor's exit code.** A FAIL anywhere
  in the table makes `ccrc install` exit non-zero. `git_email` FAILs on ANY
  machine with no global git identity — a completely ordinary fresh state — so
  before this change a new user could run `ccrc install`, have everything
  succeed, and be told the install failed because their git email was unset.
  For a tree bound for public release that is a bad first contact, and a missing
  global identity is not an install failure. Recorded rather than fixed here:
  whether `install` should inherit `doctor`'s code at all is a separate
  question with its own blast radius, and this change removes the common cause
  rather than the coupling.
