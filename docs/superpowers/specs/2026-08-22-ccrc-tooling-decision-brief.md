# `ccrc-tooling` (companion repo) — decision brief

Not a spec. The operator asked on 2026-08-22 whether it is worth publishing a second repo,
`ccrc-tooling`, holding the utility tooling around ccrc with a one-command installer "to
complement ccrc properly". Four read-only surveys (the box's tooling, ccrc's coupling to it,
the already-decided release plan, and the publish hazards) plus a three-way advocacy panel
answered it. The answer is **no second public repo, not now** — but the survey found two
different problems wearing one question's clothes, and only one of them is about publishing.

Evidence base: `wf_fcd4b921-c7b`. Every claim below is cited to a path:line or a command's
output so it can be re-verified rather than believed.

## What the surveys actually found

**Problem 1 — urgent, and not a publishing decision.** Load-bearing scripts on the reference
box are unversioned. `~/.local/bin/claude` is 173 lines, exec'd by 18 live units, injects the
OAuth token, and is versioned by `cp`. The same holds for `claude-prune-versions` (daily timer,
guarding a disk that twice reached 95%), `code-usage-hook-guard` (written after a 9.7-hour
stall), the four account wrappers, and the docserver's real `config.json`. The sharpest
instance is the docserver itself: `~/.claude-docserver` **already is** a git repo — with no
remote, one commit, a dirty tree, and a working `server.py` of 966 lines against the 770-line
copy the monorepo tracks. The artifact git knows about is 196 lines stale and the thing that
actually runs is un-remoted. This is fixed by `git init` and a private remote. No publishing
question is involved.

**Problem 2 — premature.** `git tag` → 0. `LICENSE` → absent. Stage 4's whole-branch review is
the one open checkbox of 23. No Stage 5 spec exists. The real-VM install proof is still
`PENDING-OPERATOR`. And Stage 5's own pass criterion is *"an outside developer installs from
**the public repo** using only **the README**"* — singular in both nouns, and never once run. A
companion repo advertising a one-command installer would give utility scripts a smoother front
door than the product, whose own promised `curl … install.sh | bash` does not exist yet.

**Problem 3 — the boundary is already drawn in the wrong place, and there is a measurement
proving it.** `scripts/extraction-manifest.sh:38` defines `PORTABILITY_FILES="ccd
claude-session@.service statusline-command.sh tmux.conf"` — four files — and calls everything
else in that directory "operator tooling that stays behind". `git ls-files ccd | wc -l` → **19**.
The correction ccrc needs is subtractive, not a new repo.

| Measurement | Value | Source |
|---|---|---|
| Files the manifest calls product | 4 | `scripts/extraction-manifest.sh:38` |
| Files actually tracked in `ccd/` | 19 | `git ls-files ccd` |
| Install sites for `ccd/ccclip` | 0 | grep over `ccd/ccrc`, `deploy/` |
| Git tags | 0 | `git tag` |
| `LICENSE` files | 0 | `ls LICENSE` |
| Doctor checks for `superpowers` | 0 | `grep -c superpowers ccd/ccrc-doctor-checks` |

That last row is a stranger-facing break today: `ccd/coordinator-skill/references/wave-lifecycle.md:145-146`
names `superpowers:executing-plans` / `superpowers:subagent-driven-development` as the execution
skill a worker must invoke, and nothing checks that the skill pack is installed.

**Why "private now, public later" gets the charter backwards.** The highest-value artifacts are
precisely the ones a public `ccrc-tooling` charter *cannot hold* — the launcher, the four
wrappers, the docserver's config. A repo whose stated purpose is "publish the tooling" excludes
the items whose loss would be unrecoverable. The private repo's charter is **"rebuild this
box"**, which is also the literal ask.

**The one concrete BREAK in the proposal.** `~/.local/bin/claude` passes `ccrc doctor` only
because it avoids matching `_wrap_declares_config_dir` (`ccd/ccrc-wrapper-shape:160`).
Generalising that wrapper for publication is exactly the edit that normalises the line, hard-FAILs
doctor, and — since `cmd_install` ends in `cmd_doctor` and inherits its exit code — makes every
`ccrc install` on the box start failing.

## The operator rulings

**T1 — Which driver is real?** "Share the handoff suite with other people" and "rebuild my box
in one command" are different projects with different answers, and only the second is urgent.
The recommendation below assumes the second. If the first is the real want, the sequencing
argument still holds but the contents list changes. **No recommendation — only you know which
itch this was.**

**T2 — `ccgpt` and `cck3`: publish, hold, or never?** `ccgpt`'s own header states it drives
Claude Code on ChatGPT-subscription OAuth and is "unofficial for Claude Code". Published beside
a five-lane account rotator keyed to rate limits, under a real GitHub identity, it is a
ToS/reputational artifact that cannot be recalled once forked. **Recommendation: hold** — excluded
from the first public cut regardless of T1, revisited as its own decision, never as a scrubbing pass.

**T3 — Will this project own a public network service?** This is the docserver decision with
everything else stripped away. As it stands `server.py` has no authentication in `do_GET`, binds
`0.0.0.0:8099` while its own docstring line 6 says `127.0.0.1`, and its `?ref=` parameter drives
unbounded `git fetch` writing attacker-named refs into live clones. Publishing it means owning
that — which is the same reasoning that deferred `you.ccrc.app`. **Recommendation: no, not in v1.**

**T4 — Licence pairing.** S1 ruled the product publishes under Synapsium-Labs with AGPL-3.0
(Stage 5, S8). AGPL on a bag of utility scripts is unusual and suppresses exactly the piecemeal
copying that makes them useful. **Recommendation: MIT or Apache-2.0 for tooling if it is ever
published** — but this pairs with T1 and can wait.

**T5 — The docserver's git history.** Commit `22df99d` carries `config.json`'s full 11-project
private portfolio plus a corporate author email, so scrubbing the working file is not enough.
**Recommendation: a fresh `git init`, not `filter-repo` after the fact** — there is one commit to
lose and rewriting history is the more failure-prone of the two.

## Engineering decisions (recommendations I take unless overruled)

**T6 — A private "rebuild this box" repo, this week.** Fresh `git init` — do **not** revive
`OpenClawHetzner`, which is `ahead 1, behind 20` and is not a maintained home for anything.
`.gitignore` gets `*.bak*` and `*.pre-*` in commit 1, and the initial add is an **explicit file
allowlist, never `git add -A`**: roughly fifteen stale siblings are one careless add from being
tracked, including a `config.json.bak` naming two dead worktree roots. Contents:
`bin/{claude, claude-prune-versions, code-usage-hook-guard, claude2, claude-corp, claude-dev0}`,
`docserver/{server.py, config.json}`, `handoff/`, `guardrails/hardening.sh`,
`skills/graphify-patches/`, `systemd/`. One `bootstrap.sh` that is the only path by which these
land in `~/.local/bin`, backing up rather than overwriting (`_inst_keep_aside` is the pattern to
copy). Private remote. No licence, no tarball, no issues, no de-branding — none of that is needed
for a repo whose only reader is its author.

**T7 — ccrc contractions, worth doing regardless of every ruling above.** These reduce coupling
and each is hours, not days:
- `git rm ccd/ccclip` and `server/test/ccd-ccclip.test.ts`. Mac-only (needs `pngpaste` and
  Hammerspoon), **zero install sites**, shipped in every release tarball, added solely so CI
  could run its test, and non-canonical by its own commit message (`c74d378`). Three personal
  identifiers live at `ccd/ccclip:10-12`. `ccd`'s own `clip` verb — the box-side receiver — stays.
- Add a `superpowers` check to `CCRC_DOCTOR_CHECKS` (the break measured above).
- Fix the tarball/docs mismatch: the shipped skills point at `docs/superpowers/programs/<slug>.md`
  and cite a spec that `deploy/build-release.sh:103-107`'s pathspec does not carry. One pathspec
  line, or de-reference the skill.
- Fix `ccd/ccd:8307`'s dangling `hardening/tmux.conf` (a monorepo-only path).
- Fix `server/test/source-bytes.test.ts:56`, which claims `scratch/` is git-ignored when it is tracked.
- Rule deliberately on `ccd/tmux.conf` and `ccd/ccd-cap-scopes`: both have zero readers in
  `server/src`, `agent/src`, `pwa/src`, both install unconditionally in every role, and
  `tmux.conf` overwrites a user dotfile.
- `scripts/extraction-manifest.sh` is already slated for deletion by Stage 5 S5; that discharges
  the 4-vs-19 discrepancy rather than requiring a reconciliation.
- `deploy/deploy.sh:12`'s operator-specific default SSH key name is covered by the same S5 sweep.

**T8 — Live defects to fix regardless of any publishing decision.**
- Docserver: default the bind back to `127.0.0.1` (restoring what its own docstring claims),
  constrain `?ref=` to `^[A-Za-z0-9._/-]+$` **rejecting a leading `-`** (git parses `--output=`
  from it today; the arbitrary write is blocked only incidentally), and bound the per-client fetch.
- `~/.cc-limits/gpt.json` is 25 days stale, which `server/src/limits.ts:115` cannot distinguish
  from absent. That is an overloaded-absence defect **in ccrc's own reader** and should be fixed
  on ccrc's side, not only by enabling the producing timer.

**T9 — One README appendix, zero files.** "The reference fleet's other tooling" — naming what
exists, and stating plainly that none of it is required and none of it is distributed. This closes
the outside reader's real gap at a cost of one section.

**T10 — The deferred public option, and its gate.** Gated on `v0.0.1` tagged **and** LICENSE
landed **and** the two-VM install gate run. Then, if still wanted: **one** repo, **two** items —
`cc-compact-restore.sh` (104 lines, byte-identical to the installed copy, zero operator specifics)
and `handoff/` minus `ccgpt` and `cck3`, with the roster read from `~/.ccrc/accounts.json` and the
`$/MTok` price table moved to a config file. Not the docserver. Not the launcher. Its own licence,
its own identity constant, and no coupling to `install.sh`.

## Must not be published

- `~/.local/bin/claude` — see the BREAK above.
- The four account wrappers: the roster's physical, per-box form.
- `~/.claude-docserver`'s **git history**, its `config.json` in any form, and the server itself
  for now (T3).
- The `code-usage` plugin: hardcoded corporate domain, a private AWS API Gateway, and
  self-updating executables fetched from it on a timer.
- `ccgpt`, `cck3` — held pending T2.
- The incident diaries as written in `hardening.sh` and `code-usage-hook-guard`: instance sizing,
  dated outages, and the plainly-stated fact that memory pressure kills `sshd` and `tailscaled`
  for hours while ICMP keeps answering. The mechanisms are publishable; the diaries are
  reconnaissance.
- Every `*.bak` / `*.pre-*` sibling in `~/.local/bin` and `~/.claude-docserver`.
- `hammerspoon-init.lua`, `cc-termux`, `cc`, `ccswap` — per-machine, carrying stale three-account
  rosters, and superseded by the PWA, which is ccrc's whole thesis.
- Any secret file. `.example` at 0600, refused unedited, per `MailTokenPlaceholderUnedited`.

## The honest weakness in this recommendation

A private repo's success is a habit, not a mechanism, and this operator's private repos have
already been measured rotting: `OpenClawHetzner` is `ahead 1, behind 20`, and `~/.claude-docserver`
is itself a private repo that drifted 196 lines ahead of its own only commit. The recommendation
therefore puts four load-bearing artifacts into exactly the condition that produced the drift it
cites as the reason to act. Public CI and outside readers create pressure a private repo has none of.

The one mitigation that is a mechanism rather than a resolution: ship a `box-drift` check in the
private repo on a systemd timer that `cmp`s every tracked file against its installed copy and
**fails the unit** when they differ, so drift surfaces in `systemctl --user --failed` instead of
being discovered during a rebuild. That is thinner than CI, and it is the weakest link here — but
it is a weak link on the cheap, private half of the decision, where both alternatives put theirs
on the half that is public, unrecallable, and competing with the only release proof that matters.

## A note on exposure, corrected

An earlier reading of this question assumed the ccrc repo was already public and concluded the
leak question was settled ("scrubbing only a second repo is theatre"). That premise was wrong:
`gh repo view` reports **`visibility: PRIVATE`**, and Stage 5's S3 keeps the public flip gated on
an explicit operator go. There is therefore a **clean scrub window before the flip**, which makes
the sanitisation ruled in S2 cheap rather than retroactive — and removes the strongest argument
for treating a companion repo's hygiene as hopeless.

## Ordering

1. Rulings T1–T5.
2. T6 (private repo) — independent of everything else, and the only urgent item.
3. T8 (live defects) — independent, and one of them is a defect in ccrc's own reader.
4. T7 (contractions) — folds into the Stage 5 S5 sweep where it overlaps; `ccclip` and the
   `superpowers` doctor check do not, and should ride their own small PR.
5. T9 (README appendix) — lands with the Stage 5 README work.
6. T10 — revisited only after `v0.0.1`, LICENSE, and the two-VM gate.
