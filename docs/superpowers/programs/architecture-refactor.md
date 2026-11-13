# Program: architecture-refactor

Spec: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, followed by
`docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md`.

- **D-8565 (2026-11-13)** — `architecture-refactor-closed`: the DDD, Clean Architecture and SOLID refactor is closed on
  the record, approved by the operator on 2026-11-13. Every planned item has merged: the 08-10 spec's increments 1 to 7,
  ARCH-00 to ARCH-77, waves W0 to W8, and the 2026-11-06 ruling follow-ups. The ring guards hold at zero exemptions.
  The six architecture epics are done. LIVE, LIFE, GRAM, PWA and ENF were closed on 2026-11-08. KERNEL was closed on
  2026-11-13, once its last child (ARCH-66 PR 2, #2651) had merged on 2026-11-11. The leftovers are filed as ordinary
  tickets outside the refactor (listed below). From here on the rules bind all work through `CLAUDE.md`'s architecture
  section, not through this programme.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 08-10 | increments 1 to 7 (rings, contexts, ports, deciders, enforcement) | ARCH-00 to ARCH-36 | done |
| W0 to W8 | the consolidation wave (ARCH-40 to ARCH-77) | per ticket | done |
| 11-06 | the ruling follow-ups (rulings 2 to 12) | #2400 to #2451 | done |
| close | the closure audit and triage (2026-11-13) | this file | done |

## Decisions & deviations

- Closure was measured, not assumed. A read-only audit on 2026-11-13 checked every planned item against main, and the
  epics were triaged one by one. Five epics had already been closed on 2026-11-08; an older note had still counted
  them as open.
- What closure does **not** cover. These belong to other programmes or are rulings still to make, and are not refactor
  debt:
  - the `ccd/ccd` and `ccd/ccrc` file split (`docs/superpowers/plans/2026-11-06-ccd-file-split.md`, D-8048);
  - the growth controls: measuring every large file, the ring classifier in place of the blanket new-file waiver, and
    waiver ages (D-8563);
  - the 16 grandfathered D-number collisions (D-8562), whose guard turns red after 2026-12-19.

## Carried constraints

The leftovers, filed as standalone tickets:

1. Move the mail pass's status ladder and the raw turn-word readers onto the one session reading.
2. The session stream drops its own 2-second poll; tests subscribe the way production does.
3. The lifecycle manifest's child-workspace row names the workspace transitions table.
4. Retype hook events as one shared union across their consumers.
5. Replace the growth check's blanket new-file waiver with the ring classifier (being built, D-8563).
6. The architecture spec's context map names Session host (C10) as a ccd-only context (fixed in D-8561).
7. Decide whether the `watch.ts` and `routes.ts` growth budgets are absolute caps, and make the spec match. This one
   needs an operator ruling.
8. The delegation lane's recover, upkeep and compact clocks become schedule rows, or a recorded exception.

## Next-wave brief

None: the programme is closed. The `ccd/ccd` split's Task 0 now reads the refactor as closed. Its other start condition
still holds the split. At closure, three open PRs of the session-continuity programme edit `ccd/ccd` (#2735, #2739,
#2742), so another ccd programme is open, and the split waits for it.
