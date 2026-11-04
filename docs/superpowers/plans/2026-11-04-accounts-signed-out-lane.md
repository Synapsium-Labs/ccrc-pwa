# Accounts: the box reports a signed-out lane, and whether a lane holds a credential

**Goal:** finish what the A38 wording ruling left open (the operator's option 1, 2026-11-03: neutral words until the box
and the server can say more). On any device and after a reload, a signed-out lane reads as signed out, and every account
sheet's wording is true in every path. Public issue #2234.

**Before this change:**
- N5's sign-out cleared the lane's `check` and nothing else, so a signed-out lane read exactly like one never checked.
- `laneNotReadyReason` never answered `no-credential`; only the box's `enable` did.
- `kept` hung on a passing check, and `unsure` covered everything else, a 401 and every sign-out included.
- The PWA kept an in-memory record of the sign-outs it ran (`signOuts.ts`). A reload or another device forgot it.

**Change:**
- `deploy/account-op.mjs`, the lane-state file's one writer:
  - `signedOutAt`: `--signed-out-at now`, written by `credential --sign-out` on a sign-in lane. A token lane keeps its token through "Sign the old sign-in out", so it records no sign-out.
  - `credential`: `held` or `none`, measured by `laneCredentialOf` on every write that names the roster (`--file`). It stats and never reads, and it always looks: a passing check is no measure of the file, which a logout outside ccrc removes without a word to the lane. A token lane holds its secrets file; a sign-in lane its `.credentials.json`. A lane whose credential ccrc does not read records no word, and neither does a sign-in lane with no file on macOS, where a sign-in lives in the keychain. A word the box can no longer measure is dropped.
  - What ends a sign-out is one rule in `laneStateWrite`: a passing check, or a credential measured on the lane. So each install ends it through the write it already makes after the credential is in, and a refused install does not.
  - `--mode credential`: the update's sweep. It adds the measured word to a file from before it, keeps every field, makes no file and rewrites nothing when the word stands.
  - `opReady` answers `no-credential` for a lane that records a sign-out, ahead of the check the sign-out cleared.
- `ccd/ccrc`: `_acct_lane_state` passes the roster on every write; `credential --sign-out` records the sign-out, except `absent` on macOS, which proves nothing there; a paste writes the lane state again once the new secret is in; `_inst_lane_state` runs the sweep under each lane's lock, so a sign-out from before this build reads as a lane with no credential.
- `ccd/ccd-account-health`: its 401 write names the roster, so the timer measures the lane too.
- `shared/accounts.ts`, `shared/api.ts`, `server/src/accounts/lanes.ts`: `LaneState` and `LaneWire` carry `signedOutAt` and `credential`, each held to its grammar. `stateWordFor` answers Signed out for a recorded sign-out, after Off and ahead of a 401, and `laneNotReadyReason` answers `no-credential`, in the box's order. `LaneWire.adding` is `neverEnabled`'s answer, the rule Discard reads.
- `pwa/src/accounts/connectFlow.ts`: `oldCredentialOf` reads the lane. `signed-out` where the lane says so. The neutral words on a lane the provider refused, since the 401 marker is written with no lane-state write, so `held` may be from before a logout that caused it, and a token just refused is not known to stand; and on a lane a sign-out may have changed that the store has not read since. `kept` otherwise where it holds a credential, or with no `credential` word behind a passing check. `isPastAdding` counts a sign-out on a lane that is not `adding`, so a resumed sign-in on an Off lane reopens the re-auth sheet, and a lane the connect sheet is still adding stays the connect sheet's, with its Turn it on and Discard.
- `pwa/src/accounts/signOuts.ts` is gone, and the rule it kept moves to the lanes' one reader. `pwa/src/stores/fleet.ts`: `markLaneUnread` marks a lane a sign-out may have changed, and the mark goes with the first good read of the lanes that started after it. A failed read leaves it, and so does a read already in flight. A sign-out with no answer holds the mark as long as the verb can run, because a read before the verb ends shows the lane as it was. An answer older than the newest landed is dropped, so a 20 s poll cannot write the lanes from before back. The re-auth and connect sheets mark and read on any answer that may have signed the lane out, open or closed (`readLaneAfterSignOut`). The sheet that ran the sign-out still knows first (`useOldCredential`'s `signedOutHere`).
- `useOldCredential` never moves to `kept`, and an `unsure` sheet moves to `signed-out` when the lane says so.
- `pwa/src/fleet/accountWords.ts`: the trouble card says the lane was signed out on the fleet host, with no HTTP 401 and no claim that placement avoids it; `offAlso` says so on an Off lane.
- `pwa/src/accounts/MethodSwitchSheet.tsx`: a lane signed out before the switch offers no old sign-in to sign out.

**Why a second field and not a capability word.** A sign-out record alone cannot say the lane has a credential: a lane never signed in, a token lane with no key file and a sign-out from before this build all read "no sign-out recorded". Saying "keeps its old token" on those would be false. Measuring `credential` makes the file self-describing, so an absent word is the older box, lane by lane, with no new `ccd caps` token and no second reader.

**Order and compatibility.** Box half first. An older server drops both fields in `laneStateOf`, since it reads only the fields it names, and a newer server on an older box reads neither and falls back. No agent change: the fields ride the existing `read` op.

## Deviations found

- **D-7992 (2026-11-04)** — The box reports a lane signed out, and whether it holds a credential, on the lane wire. Known limits: `credential` is measured at lane-state writes and at the update's sweep, so a credential removed by hand reads as it was until the next one, or until a 401 makes the lane neutral. A sign-out run from another device reads as it was until this one's next poll.
