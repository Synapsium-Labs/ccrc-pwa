# Overlord W1: the isolation word, build notes (run 3300)

What this build learned against its plan, `docs/superpowers/plans/2026-11-14-overlord-w1/w1-isolation.md`, for the
coordinator to fold into the ledger. The plan's own departures (its "Deviations found" list) stand as written; the slugs
below are this build's, from the plan or from main as it stood at `b33a9ae137` on 2026-11-22. No number is minted here.

## Departures from the plan

| Slug | What the plan says | What was built, and why |
|---|---|---|
| `separate-user-needs-an-equal-digest` | `linkIsolation` step 6 widens to `separate-user` once the peer uid, the report's uid and every server fact agree | `separate-user` also needs the report to show a measured digest equal to the server's, machine or boot. Without it, Review Focus 3 fails: a local forward whose two digests both differ reads `forwarded`, and replacing either digest with `unmeasured` made the same link read `separate-user`. The generated domain test caught it. A link with no equal digest now reads `unmeasured: host-unmeasured`. An honest Linux agent on this kernel always reports an equal boot digest, so nothing real is lost. |
| `server-digests-computed-by-the-reader` | `LinkFacts` carries the `bearer`, `ServerFacts` carries the raw `ids`, and the L1 deciders digest at each comparison | L1 imports no `node:crypto`, so the reader (L3) digests the server's ids under the link's bearer and passes `serverDigests` in `LinkFacts`. `measureServerFacts` answers `{ facts, ids }`: the ids stay in the reader's memory and never reach a decider. `linkKernel(link)` and `hostRelation(link)` lose their `server` argument, and `wakingHostKey(mode, localDigest, link)` takes the local digest the reader made under its boot key. |
| `peer-facts-type-in-l0` | `PeerFacts` is declared in `isolationFacts.ts` (L3) | It lives in `shared/isolation.ts` (L0), because the L1 deciders and `FleetState` name it and L1 may not import L3. `isolationFacts.ts` re-exports it. |
| `ready-serial-on-fleet-state` | `FleetState` gains `hostReport` and `peer` | It also gains `readySerial`, the count of readies, which the client writes in the same ready stanza. The carrier's `keyEpoch` needs it, and the reader caches nothing, so it cannot count readies itself. |
| `operator-model-db-is-held` | The held secrets list ends at `accountsPath` | `operatorModelDbPath` (the Overlord's private store) is held as a secret too. It landed after the plan was written. `buildInfoPath` and `installedCcrcPath` are in the named exception list: the server reports them, and they hold no secret and choose no code. |
| `unmeasured-locality-reads-host-unmeasured` | `linkIsolation` step 5: "the kernel is `same` and the peer is not `local`" reads `other-namespace` | A peer whose locality could not be measured (no remote address on the socket) reads `host-unmeasured`, not `other-namespace`, which would name a namespace nobody measured. Only a measured `not-local` peer reads `other-namespace`. |
| `darwin-unit-is-the-launch-agents-directory` | The unit is `ccrc.service` in the user unit directory | On macOS `ccd/ccrc` installs a launchd job under `~/Library/LaunchAgents` with a generated label, so the held control path there is that directory. The parity test pins both directory spellings to `ccd/ccrc`. |

## Measured, not assumed

- **The witness relation's wiring is not in this PR.** Authority journal B (run 3299) is not on main. Its exchange keeps
  its own `HostRelation` and a stand-in relation answering `unmeasured` until this PR lands, and whichever PR lands
  second re-points it to `AgentHostRelation | 'console'` and asks `deps.isolation.relationOf(...)`. In W1 the relation
  counts no agent, so the authority plan's residual on the witness file stays true. A later piece that makes
  `other-host` reachable must re-argue that residual first (plan question 18); `hostRelationSuite` pins that no input
  of the generated domain yields `other-host`.
- **The ladder's pin is now presence and value, never a count.** Sandbox B, authority journal B and renewal readings C
  each add rows to the same table, in any order.
- **Every `LadderConditionInputs` literal in the tests gains `'shared-user'`.** That includes eleven in the ladder actor
  and route test files, which run 3296 holds; they were edited under the coordinator's ruling of mail 30748.
- **README.md's hunk** (the agent security model's "Host report" bullet) was applied exactly as packeted, with run
  1850's coordinator's yes (mail 30888).
- **Live host reads in older link tests.** `connectToAgent` and `bootAgent` now pass synthetic peer seams and host
  roots. Tests in other files that build a `FleetClient` directly, against a fake agent, still read the live TCP
  socket tables to measure their peer. The answer stays in memory: it is never printed or asserted.
- **Mutation floors.** Eight sets in `server/test/sim/isolationSets.ts`, 67 mutants, every one killed (floor 1). The
  hand mutants the plan names for the agent seam, the client's ready stanza and the ladder input were each run from a
  saved copy and each reds its case.
