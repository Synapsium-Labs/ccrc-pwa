# Landing order wave 5o, Task 4: the README (D-9159)

Run 4111 (wave 36). Plan: `docs/superpowers/plans/2026-11-27-landing-order-wave5o-held-head.md`, Task 4 and section 8.
Built on `main` `5576023f2553c43f53532a3445fdc48c25dda558`.

## What changed

One sentence beside the next-to-land mail's, in the paragraph that begins "The main-red hold has one writer": three whole
physical lines became five, +274 bytes, as section 8 measured. Applied with Task 4 Step 2's script over section 8's old and
new blocks (`text: one change applied`: the old text once, the new text once). No other README text changes; D-9160
changes none.

## Packet

`README.md` is another run's claim. The unified diff against the base (1412 bytes, sha256
`42f6cabff8917db1b7eee330695364836d45e0ddb02e2a1fd038499a64ae3201`) went to its holder before Task 1; the holder answered
yes, and said its own branch touches the README only far from this paragraph. The applied hunk is the packet's, byte for
byte (only `git diff`'s hunk-header context differs).

## The README's readers (section "What was measured"), one file per process

All passed: `box-token-census` 90, `readme-holds` 17, `readme-roster-mirror` 5, `license` 25, `topology-clean` 62,
`anchors` 9, `citations` 4, `ccrc-settings-census` 22, `child-reclaim-prose` 4, `collect-lane-prose` 15,
`collect-switch-prose` 9, `conflict-sync-text` 5, `crossrepo-prose` 17, `dead-coordinator-prose` 25, `expiry-lane-prose`
20, `pools-prose` 27, `privacy-journal-census` 3, `stall-settings-prose` 15, `stall-settings-readme` 6,
`mail-inbox-skills` 6, `overlord-skill` 20, `coordinator-skill` 290, `workflow-control-census` 10, `history-skill` 27,
`history-lib` 1616, `history-cli` 117 (1 skipped), `ccrc-doctor-session-path` 40, `ccrc-install-graphify` 78,
`ccrc-update-fetch` 129 (6 skipped), `install-session-hooks` 49, `ccrc-settings-verb` 132, `session-hook-steer` 120,
`history-replay` 1899. The first `history-replay` run was killed by the test slice's shared 6G memory cap (a worker
SIGKILLed, 1196 of 1899 passed and none failed); the re-run passed whole. `session-hook`, run alone, passed 740 (6 skipped).
