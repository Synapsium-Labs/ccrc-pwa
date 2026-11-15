# W1 sandbox, PR A: the builder's notes

What PR A (Tasks 1 to 5 of `w1-sandbox.md`) found and departed from, by slug, for the coordinator to fold into the ledger.
The load-path measurement and the coordinator's rulings on it are in `load-path.md` beside this file.

## Ruled by the coordinator during the build (2026-11-15)

- **`resume-carries-its-own-start`**: a resume writes no start attachment, so at a resume the hook carries `instructions`
  and `hooks` from the newest reported `startup` of the same transcript, only when that report's digest and build equal
  this session's, and names it `carriedFrom`. Otherwise both read `unmeasured`.
- **`tools-read-from-the-prompt-snapshot`**: the door's tools are offered directly, so the kind `tools` (and
  `toolServers`, derived from it) is read from the first tool-bearing `prompt_snapshot` after the first request. The
  deferred-tools kind is dropped from `START_LOAD_KINDS`.
- **`own-lists-are-a-rig-lower-bound`**: `CLAUDE_CODE_OWN_LISTS` holds the rig's lists; nothing in PR A judges against
  them, and a live read is a Needs-first of PR B.

## The builder's own departures

- **`loads-body-assembled-in-transcript-jq`**: the hook's report body and the list of what it hashes are built by two
  entries of `ccd/lib/transcript.jq` (`loads_body`, `loads_hash_items`) beside `start_loads`, so `ccd/session-hook.sh`
  stays at its +31 estimate. The hook keeps the spool, the hashing (jq has no digest) and the send.
- **`instructions-hashed-where-they-stand`**: an `instructions` entry's `sha256` is the digest of the file at the path the
  attachment names, read by the hook at report time, not of the attachment's `content` (Claude Code trims the file's
  final newline there, so that text would never equal `constitutionSha256`). The residual: a file edited between the
  load and the report is hashed as edited.
- **`loadlast-registry-field`**: the resume carry needs the last reported `startup`'s `reportId`, digest, build, its
  window's begin and end offsets (the end is its first request, so the carry reads that start's own window only: review
  2135 F4) and transcript path, so the hook writes `$REG/<id>.loadlast` on that report's 202. Like `loadpending`, it is written
  without the registry lock, and `_reg_purge` removes both a second time after `generation` (the count comment is 61).
- **`rig-gains-links-root-files-and-a-snapshot-stub`**: the W0 rig's `launch.files` gained `link` entries (held under the
  run root) and `in: "root"` files, `--remote-control` joined its flag list, and `stubs/transcript-snap.mjs` copies the
  transcript at each hook event. A fourth scenario, `ov-sandbox-plugin-control.json`, is M8's control.
- **`build-agreement-reader-moved-to-fleetstate`** (replaces `build-agreement-read-beside-inventory-builds`, review 2135
  F5): `inventoryBuilds` moved from `server.ts` into `fleetstate.ts`, exported, and is the one reader of the inventory's
  builds: `/api/fleet/health` imports it, and `fleetstate.ts#inventoryBuildAgreement`, the lane's read, is composed from
  it. `server.ts` shrinks by 11 net code lines.
- **`a-both-box-agrees-with-itself`** (ruled, review 2135 F2): the spec keeps today's single box a supported case of every
  rule, so a box that is both ends (a `both` row with no `fleet` row beside it) reads build agreement `agreed` once its
  stamp reads, dirty or not, as `fleetCarriesRunsAttribution` treats `both`; an unreadable stamp reads `unknown`. A `both`
  row beside a `fleet` row is compared with that row as a server row is (agreed on one clean sha, else skewed). The rule
  is in `inventoryBuildAgreement`, not `derivedBuilds`, so the health route's `build` word, which `derivedBuilds` feeds
  and whose test pins a lone `both` row's `fleet` as null, is unchanged.
- **`refused-spawn-characterization-not-in-pr-a`**: Task 3 Step 1's characterization of a refused `_spawn_start` under
  `supervise`, `cmd_ensure`, `cmd_start` and `cmd_swap` is not in this pull request; PR A's tests pin the refusal at
  `_spawn_start` (no pane, rc 1, one journal line). Task 6 (PR A2), which changes the swap and resume paths, carries it.
- **`profile-refusal-dies-in-spawn-start`**: the plan writes `_profile_spawn_compose … || return 1` in `_spawn_start`. Every
  failure there is a `die` (D-300, pinned by `ccd-arith-containment.test.ts`), because a bare `return` would let the
  `|| return $?` callers skip `_reg_claim`, so the refusal dies instead, after its one `launch-profile-refused` line and
  before any pane starts. Each caller still sees a non-zero status.
- **`profiledigest-joins-the-route-after-pool-set-a1`**: `ROUTE_WRITABLE_FIELDS` gains `profiledigest` after
  `acctorder`, which pool set A1 (#2836) appends on the same line, so the field and the route-field censuses land in one
  main merge after #2836, on the coordinator's word.

## Fix round 1 (review 2135, the coordinator's rulings of 2026-11-15)

- **F1**: the loads arm reads `${CCRC_LAUNCH_PROFILE:-}` once; a Stop with no profile over a stale `loadpending` removes it
  and returns 0, sending nothing.
- **F3**: the wait path falls through to the shared tail, so every path ends at the generation re-check; the purge
  comment in `ccd/ccd` (`_reg_purge`'s second `rm`) now says so. A test drives a purge during the wait path's read.
- **F4**: `start_loads` answers the window's end (`sl_end`, its first request's byte offset), the hook spools it beside the
  body and writes it into `loadlast`, and the carry reads only that start's begin-to-end range. A test with a compaction
  between startup and resume pins the exact carried instructions and hooks.
- **F6**: one deadline (`LOADS_BUDGET_MS`, 3 s) bounds the read, each hash and the send; an instruction file is hashed
  only when it is a regular file of at most `LOADS_FILE_MAX` (1 MiB), by a `cat` inside `_hook_timeout`. Tests: a FIFO
  path and an oversized file each read `instructions` unmeasured, and the report still goes in the same Stop.
- **F7**: `_profile_digest_ok` hands back the profile, the digest and the row it read (`jq -cS`), and the surface is
  rendered from that row: one read of the profiles file, pinned by a test that counts them. The later existence check is
  `[[ -n $sf ]] ||`.
- **F8**: tests for the read overrun, a send with no answer (rc 124), the fifth try after send failures, a `profile`
  field present but unreadable, and each ccd refusal's reason. **The skew-lane case is carried to designation A**: plan
  Task 2 Step 1's "a pass under skew sends no profiledigest" is unreachable from `profilePass` today, because `roleOf`
  answers `overlord` only from a designation, so `builds ?? 'unknown'` and the `hold` mapping in `profileLane.ts` are
  driven only once designation A writes one.
- **F9** (carried to PR B and the next spec pass): PR B's verdict re-checks the carry server-side: `carriedFrom` must
  resolve to a `startup` start of the same session with a non-conflicted report and equal digest and build, else
  `instructions` and `hooks` read `unmeasured`. **F10**: accepted as consistent with D-300 and the tmux-failure leftovers.
  **F11**: watched in PR B.
- **Nits**: `REPORT_ID_RE` is defined once (`continuity/startLoads.ts`, read by both doors); `StartLoadsReport` extends
  `shared/overlord-sandbox.ts#StartLoadsBody`; the second `UNMEASURED` in L0 records its reason (L0 imports nothing) and a
  test pins it equal to `server/src/unmeasured.ts`'s; `insertStartLoads` joins only a `startup` or `resume` start; the
  L4 census names the loads door; the new `REFUSAL_STATUS` entry says CHOSEN, not measured; `PROFILE_ROW_JQ` refuses
  control characters in the `--agents` value as well as `'`; `2>/dev/null` stands before `<` in the loads arm; the
  "computed once and spooled" comment says what the code does (a send that does not take the body spools it).
- **Records**: the migration slot is 76: the plan said 74, the branch took 75, and the push outbox (#2838) took 75 first,
  so on the coordinator's word of 2026-11-15 this PR merged `main` once and renumbered to 76 (one more renumber may come at
  landing, on that word). `server/src/watch.ts` grows by 1 (the lane's build-agreement wiring). The real-`jq` digest check
  lives in `server/test/sim/launchProfileSets.ts#launchRowCases`, run from `continuity-launch-profile.test.ts` and the
  mutation floor, not in `launch-profiles-file.test.ts`.

## Measured growth (against `origin/main`)

After fix round 1, against the merge base `bfc0a1259`: `ccd/ccd` +33 net code lines, `ccd/session-hook.sh` +33 (+31
before the round), `ccd/ccrc` +3, `ccd/ccrc-api` +1, `server/src/coord/schema.ts` +17 (the plan's +16 and the
`carriedFrom` column the resume ruling adds), `server/src/coord/store.ts` +2, `server/src/watch.ts` +1,
`server/src/server.ts` -11 (F5), `shared/api.ts` 0 (one line edited, after #2836).
