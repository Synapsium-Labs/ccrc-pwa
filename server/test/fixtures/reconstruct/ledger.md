# Program: build4-transcript-surface
Spec: docs/superpowers/specs/2026-08-09-build4-transcript-design.md   Plan: docs/superpowers/plans/2026-08-10-build4-transcript.md   Workspace: ccrc-pwa-clear-cove
## Waves
| # | scope | PRs | state |
| 1 | the event model and the store slot | #577 | merged |
| 2 | ChatItem arms and the virtuoso list | #583 | merged |
| 3 | mail in the transcript, and the jump-to-latest pill | — | in flight |
## Decisions & deviations
- Wave 2 kept `ChatListInner` as the jsdom renderer rather than mocking virtuoso a second time.
## Carried constraints
- The settled label must stay ONE text node (header.test.tsx reads it with getAllByText).
## Next-wave brief
Rebase `ws/clear-cove` onto main first. Wave 3 adds the mail ChatItem arm; the strip above the composer already ships and must keep working unchanged.
