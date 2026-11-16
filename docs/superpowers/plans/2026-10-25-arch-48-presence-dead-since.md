# ARCH-48: the fleet frame carries presence and deadSince from readSession: Plan note

ARCH-48 (#783, PR #1400) moves the session-status ladders onto `readSession` (`server/src/sessionReading.ts`): the
fleet frame's row carries `presence` and `deadSince`, `SessionStream.resolve` reads the registry arm and the turn word
from it, and `liveStatus` is deleted. One reader, `claimProbe`, stays on the frame row's `status === 'dead'`, because
moving it would change claim-lapse answers in a live lane. One number, D-6908, was issued for that candidate ruling.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (C1, SessionReading).

## Deviations found

- **D-6908** — `claim-probe-doubt`, a CANDIDATE RULING, not implemented by #1400: `claimProbe` reads a restarting
  holder (pane gone, supervisor heartbeat fresh, `presence: alive`) and a holder whose pane tmux did not answer
  (`presence: unknown`) as `unmeasurable`, so the claim renews like any other doubt instead of lapsing as `gone`. Both
  rows read `gone` today and are pinned so in `server/test/session-ladders-characterization.test.ts`. Until it is
  ruled, behaviour is unchanged and #783 stays open for this one reader. If ruled, it lands as a behaviour commit of
  its own with before/after rows in that characterization suite.
