# Coordinators decide by default — plan (ledger entry; tasks to follow)

**Spec:** `docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` (rev 2).

**Status:** the tasks are not written yet. The spec's waves A1 to A10 (§13) become this plan's tasks once the
operator has answered the four open questions in the spec's §15. Until then this file holds the ledger entry below,
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
