# Program ledger — template

Copy this file to `docs/superpowers/programs/<slug>.md` when an orchestrator
starts a multi-wave program (`ccd ws-hold --session <id> --reason
"program:<slug> wave:1/N"`). It is a **convention, not a parser** — nothing in
ccrc reads this file; it exists so a fresh session, and a human reviewing a
handoff commit, can reconstruct where the program stands without replaying any
prior wave's transcript. Shape, verbatim from
`docs/superpowers/specs/2026-08-06-workspace-hold-programs-design.md`'s
"Mechanism 3":

```markdown
# Program: <slug>
Spec: <link>   Plan: <link>   Workspace: <session id>
## Waves
| # | scope | PRs | state |
## Decisions & deviations     (why, not just what)
## Carried constraints        (findings deferred across waves — reviewers get these)
## Next-wave brief            (what the fresh session needs; nothing else)
```

## Handoffs are commits

A program's memory lives in this file; every session touching it is
disposable. Both handoff directions ride it: orchestrator→wave is the ledger
plus the wave's plan slice, and wave→orchestrator is the wave's own closing
commit — the session's last act before the orchestrator stops it. Each
handoff is **a commit**, diffable and reviewable, so the quality gate on a
handoff is ordinary code review rather than a fresh conversation trying to
judge a compacted transcript it never saw. The **Next-wave brief** section is
the whole of what a fresh session reads to start the next wave — not the
prior wave's chat history, not its scratch notes, just this file as it stood
at the last handoff commit. If the brief is missing something the next wave
needs, that is a defect in the ledger, not a reason to go looking for it
elsewhere.
