# Linear central key, task LK11: the Settings routes as built

Task LK11 of the Linear central key plan (#1444) builds the four `/api/linear/workspaces` routes (spec §10.1), journaled
as spec §7 says. Measured on the tree it was built from, five things the plan and the spec leave open had to be settled,
and one number records how.

- **D-7741 (2026-11-01)** — `linear-workspaces-routes-as-built`: the Settings routes' registrar, the add's floor before
  its workspace is known, and the key acts' journal rows.

**A registrar of their own, in the same file.** The plan puts the journal "into `registerLinearRoutes`", and also says
`linear-connection-routes.test.ts` stays unchanged. Both cannot hold: the plan's rule for absent services (D-7684) makes
each service a required `T | null` option, so adding `journal` to `LinearRouteOpts` would change the three tests that call
`registerLinearRoutes` directly. So `server/src/linear/routes.ts` gains `registerLinearWorkspaceRoutes`, beside it, with
its own options (`journal` among them, required). The four legacy routes and their options are unchanged, the nine routes
are in one file for `auth-gate.test.ts`'s scanner, and `server.ts` calls both registrars with the same gate and services.

**The add's floor.** Spec §6.7 charges the account-gated key acts to the slot's floor. An add, or a replace, checks a
key that has no slot yet, and the slot is named by the workspace, which only the check's answer tells. So the pasted
key's pages go to one fixed bucket, `LINEAR_ADD_SLOT`: the floor of a slot that is no workspace's (the nil UUID; Linear's
ids are version-4 UUIDs). Its size is the floor's, so adds stay bounded. A Linear 429 on an add closes that bucket, not
the workspace's slot: a known limit, since an add is an operator's act behind a step-up. A check of an existing slot is
charged to that slot's floor, as the refresher is. `refresher.ts` gains `checkLinearKeyThrough`, which `checkLinearSlot`
now calls, so the add and the stored-key check share one copy of the rate service's take and settle.

**What an add stores.** A slot needs its workspace's id, and a partial team list could route a team to the wrong slot,
so an `ok` answer that did not name the workspace whole stores nothing and answers `malformed`, or `rate-limited` when
the rate service refused the second page. `replace` is a boolean or absent. A check of a slot whose key file is gone or
holds no usable key answers `not-connected` (409) with the list, as the legacy Check again does.

**The key acts' rows.** The row's op is `key-replace` when the body says `replace: true`, else `key-add`. An add's and a
replace's row is written before the check names the workspace, so its slot id is null; a check's and a remove's carry
the slot id. The outcome is `ok`; `refused` for a refusal of the act (`workspace-exists`, `key-rejected`,
`key-forbidden`, `rate-limited`, `not-connected`); or `failed` for an act that could not complete (`timeout`,
`unreachable`, `malformed`, `write-failed`). A check is answered with the list whatever Linear said, as the Check again
is, and its row says what the check found. A body that fails its own checks (`bad-request`, `bad-key`, a bad `:id`) is
refused before the row, as a session write refused before routing gets none.

**Directory refreshes.** An add, a replace and a check that Linear answered `ok` queue the slot's directory refresh and
count as its teams refresh. A failed check queues nothing, since the directory's pages would fail the same way.

**Fixtures.** The coordinator's fixture capture (FX, D-7684) has not run. The rows here use the proxy rig's stand-in,
written from the spec's shapes. The rows that need a recorded key-check answer stay `it.todo` naming FX.
