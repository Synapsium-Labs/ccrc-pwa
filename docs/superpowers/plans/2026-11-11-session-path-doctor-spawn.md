# Doctor's session to come gets the folder ccd's launch line adds

- **D-8333 (2026-11-11)** — doctor's session to come: with no live session to read, `path` and `graphify-path` measure
  the user manager's PATH as ccd's launch step leaves it (`_dr_spawn_path` in `ccd/ccrc-doctor-checks`, the same rule as
  `SESSION_PANE_PATH`, D-8050: `$HOME/.local/bin` added last when absent), and the root-step remedy says a session's own
  restart also gives it the folder.

## Why

D-8050 gave every session ccd launches `$HOME/.local/bin` on its PATH, and the live check found every session launched
since then has it. What was left on `main` was doctor's fallback. With no session running, `_dr_session_paths` read the
user manager's PATH and reported it as the PATH "a session started now would run". The manager's PATH has no
`$HOME/.local/bin`, so on a fleet box with no session running `path` warned, and `graphify-path`, a FAIL check, failed
whenever graphify was installed only in that folder. Its remedy was a root step that a new session no longer needs.

## What changes

- `ccd/ccrc-doctor-checks`: `_dr_spawn_path` applies the launch step's rule to a PATH, and the manager fallback adds
  its result. The `DR_SESSION_FROM` sentence says the folder was added. The header no longer says ccd leaves PATH alone.
- `DR_SESSION_NOT_THESE`, the tail of both root-step remedies, adds that a restart gives a session the folder. That
  is the fix for a session launched before D-8050.
- `server/test/ccrc-doctor-session-path.test.ts`: the two rows that pinned the old fallback now pin the new one, a
  `graphify-path` row covers the same case, and one row runs ccd's own `SESSION_PANE_PATH` word and `_dr_spawn_path`
  over the same PATHs, so a change to one rule without the other fails the test.
- `server/test/ccd-session-path.test.ts`: in a started session, the command the graph gate teaches (`GRAPH_RUN`, read
  from `ccd/session-hook.sh`) and a bare `graphify` both answer.

## Deviations found

- No launch line needed a change: both of `_spawn_start`'s lines carry `SESSION_PANE_PATH`, every account kind reaches
  them, and no other path in ccd starts a session's wrapper. The unit, the wrappers and `ccd/session-hook.sh` are
  unchanged.
- Still open from D-8050: an account whose `settings.json` sets `env.PATH` keeps that value, and doctor cannot see it.
