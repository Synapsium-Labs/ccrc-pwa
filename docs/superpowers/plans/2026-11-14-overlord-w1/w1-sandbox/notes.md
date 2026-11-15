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
- **`loadlast-registry-field`**: the resume carry needs the last reported `startup`'s `reportId`, digest, build, offset and
  transcript path, so the hook writes `$REG/<id>.loadlast` on that report's 202. Like `loadpending`, it is written
  without the registry lock, and `_reg_purge` removes both a second time after `generation` (the count comment is 61).
- **`rig-gains-links-root-files-and-a-snapshot-stub`**: the W0 rig's `launch.files` gained `link` entries (held under the
  run root) and `in: "root"` files, `--remote-control` joined its flag list, and `stubs/transcript-snap.mjs` copies the
  transcript at each hook event. A fourth scenario, `ov-sandbox-plugin-control.json`, is M8's control.
- **`build-agreement-read-beside-inventory-builds`**: the lane reads build agreement through a new
  `fleetstate.ts#inventoryBuildAgreement`, which composes the same three functions as `server.ts`'s local
  `inventoryBuilds` (five lines). PR A does not edit `server.ts` (the plan's row is 0), so the two stand side by side;
  the follow-up is to have `/api/fleet/health` call the new one and delete the local copy.
- **`refused-spawn-characterization-not-in-pr-a`**: Task 3 Step 1's characterization of a refused `_spawn_start` under
  `supervise`, `cmd_ensure`, `cmd_start` and `cmd_swap` is not in this pull request; PR A's tests pin the refusal at
  `_spawn_start` (no pane, rc 1, one journal line). Task 6 (PR A2), which changes the swap and resume paths, carries it.
- **`profiledigest-joins-the-route-after-pool-set-a1`**: `ROUTE_WRITABLE_FIELDS` gains `profiledigest` after
  `acctorder`, which pool set A1 (#2836) appends on the same line, so the field and the route-field censuses land in one
  main merge after #2836, on the coordinator's word.

## Measured growth (against `origin/main`)

`ccd/ccd` +33 net code lines, `ccd/session-hook.sh` +31, `ccd/ccrc` +3, `server/src/coord/schema.ts` +17 (the
plan's +16 and the `carriedFrom` column the resume ruling adds), `server/src/coord/store.ts` +2, `server/src/server.ts` 0, `shared/api.ts` 0 (one line edited, after
#2836).
