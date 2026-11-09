# Coordinators decide by default — plan (ledger entry; tasks to follow)

**Spec:** `docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` (rev 3, approved 2026-11-09).

**Status:** the tasks are not written yet. The spec's waves A1 to A10 (§13) become this plan's tasks. The operator
approved the spec and answered §15 Q1 to Q3 on 2026-11-09; Q4 (row 49) stays open and its change is not built. Until
the tasks are written this file holds the ledger entry below,
so that the spec can cite D-8126: `server/test/deviation-refs.test.ts` takes the D-number high-water from the
definition lines in this directory only.

## Decisions and deviations

- **D-8126 (2026-11-09)** — the operator's rulings on coordinator autonomy as the default.
  - **Complaints:** (1) coordinators ask the operator low-level questions and wait, when the answer is easy to work
    out from the programme's goals; (2) a coordinator working a programme must stop for one reason only — a decision
    or act only the operator can make, or being physically blocked — and otherwise never stalls, stops or pauses,
    using maximum autonomy, self-healing recovery and resilience to take the programme to completion.
  - **Rulings:** default and always on, not a time window, superseding the earlier autonomy-window idea. Before
    asking the operator anything, a coordinator works the answer out from the programme's goals and definition of
    done (the Goals pin and the ledgers), decides, records the call and keeps going. Only the operator decides
    irreversible or outward-facing acts (SAFETY-listed destructive or live-box acts, publishing, messaging people),
    spend beyond plan (usage credits, paid services, new accounts), changes to the programme's goals, scope or what
    "done" means, and credentials and access. Physically blocked, a stop allowed only after self-healing was tried:
    no account has room; the box is out of disk or memory after its own cleanup and the memory gate; an external
    service is down after retries with backoff; a repository or tool it cannot use within its rights. Only the big,
    design-level calls reach the operator, each overturnable; routine calls are not surfaced. Everything else is a
    fault to recover from: the coordinator skill's stop-and-report refusals get recovery paths, and the 2026-10-20
    "coordinator does it itself" ruling (fleet-capacity spec §3.5(e), D-6091 to D-6097) is built.
  - **Related, in flight:** D-8125 (coordinators lift review caps themselves), D-8123 (the limit watchdog), D-8124
    (the admin-merge door).
  - **Answers of 2026-11-09 to the spec's §15:** (1) the spec approved as written, with the author's calls R6, R7 and
    C1 to C25 and the words of clause 21; the agent may run the coordinator-skill installer itself where a dispatch
    measures `skillState: absent` (row 38 self-heals; §8.3 item 5 is built). (2) Under the operator's pause,
    non-dispatch work continues (landing already-reviewed PRs, reviews, docs); dispatch, the in-place bind and
    self-work on new waves stay forbidden (clause 4, row 1, the skill's `paused` entry). (3) Comments on other
    people's PRs and issues in public repositories, and tracker writes that mirror to public GitHub, are both routine,
    not operator-only (C2, the O1 line). (4) Not yet answered: whether D-8126 supersedes the 2026-09-22 debugging
    ceiling; row 49 stays as the operator's instruction stands (the third attempt is a rung a human chooses), its
    change is not built, and the question stays open in the spec's §15.
