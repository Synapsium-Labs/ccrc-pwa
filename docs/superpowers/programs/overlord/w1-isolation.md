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
| `held-chain-resolved-link-by-link` | A held path's chain is "its leaf and its directories, and for a path that is a symbolic link, the link's own location and its chain too" | The review (F1) found the first build measured one hop only: a link met while resolving a link's target, its holding directory and its owner, were never seen. The chain is now resolved one component at a time from `/`, through a `readlink` seam, recording every directory and every link (by its owner only; a link's mode grants nothing and never guards a secret). An unreadable element or target, a component below a non-directory, or more than `CHAIN_STEPS_MAX` (256) steps reads `unmeasured`, never a partial chain. |
| `no-peer-seams-reads-unmeasured` | The peer is measured over the real interfaces and TCP tables, through a seam tests replace | A `FleetClient` given no peer seams measures no peer and reads `unmeasured`; only the composition root passes `realPeerSeams()`, pinned by a call-site guard (review F7). So no link test, older ones included, reads the live host, whatever it passes. |
| `isolation-wiring-is-one-seam` | The composition root builds the reader and the log, notes once at boot, and subscribes the log to the link | The wiring is one function, `wireIsolation` (isolationLog.ts, L4), which index.ts calls once, so its test pins the live state object and both listeners (review F5). It adds no writer. |
| `only-resolved-ancestry-guards-reads` | Question 11 names the leaf and its directories, including the resolution through links | Only the resolved leaf and its actual ancestors can guard reads. A directory that only hosted a link still contributes ownership and write exposure, but never read protection. A parent step is followed after any preceding link. If no resolved component could guard reads, the holding is exposed even with an unmeasured server UID; if that UID could establish the guard, exposure remains unmeasured. |
| `code-root-without-marker-is-unmeasured` | Question 11 holds the root the running entry loaded from, never a guessed path | The bounded search requires a regular package marker. Only a missing marker lets the search continue. Without an established root, the named code holding remains in the list with ownership and exposure both unmeasured; the entry directory is not a fallback. |
| `non-local-proxy-with-equal-digests` | The Task 3 proxy case is `kernel-unproven`, with relation `unmeasured` | The distinct proxy fixture has an agent reporting both local digests. The peer itself is not local, so the isolation reading is `unmeasured: other-namespace`; the link relation is `same-host` on the equal digests. The bridge case with no equal digest remains `unmeasured: kernel-unproven`, with relation `unmeasured`. Neither widens isolation or counts as a witness; the runtime rule did not change. |
| `ready-adjacent-callback-type-guards` | Task 2 adds the ready report and socket measurement; tail and PTY dispatch are out of scope | The changed-code CodeQL check flagged the dynamic calls to tail and PTY listeners. Each now checks `typeof listener === 'function'` before invocation. Both maps hold callbacks; no wire or dispatch policy changed. |
| `undecodable-link-target-is-unmeasured` | A held path's link target must be measured as written (question 11) | The filesystem adapter decodes target bytes as strict UTF-8 without dropping a leading BOM. If the bytes cannot be decoded losslessly, it returns `unmeasured`, not a substituted name or observed absence. The adapter contract test stubs only the OS read and checks both invalid bytes and valid text without resolving a path. |
| `isolation-row-wording-follows-table` | Task 4's inline `spec` text names `shared-user` only | The cause row's explanatory text and exact pin now name `shared-user` or `unmeasured`, as in Table 7.5a. The key, cap, notice and behavior are unchanged. |

## Measured, not assumed

- **The witness relation's wiring is not in this PR.** Authority journal B (run 3299) is not on main. Its exchange keeps
  its own `HostRelation` and a stand-in relation answering `unmeasured` until this PR lands, and whichever PR lands
  second re-points it to `AgentHostRelation | 'console'` and asks `deps.isolation.relationOf(...)`. In W1 the relation
  counts no agent, so the authority plan's residual on the witness file stays true. A later piece that makes
  `other-host` reachable must re-argue that residual first (plan question 18); `hostRelationSuite` pins that no input
  of the generated domain yields `other-host`, and the reader port is checked with both equal-digest and unproven
  non-local peers.
- **The ladder's pin is now presence and value, never a count.** Sandbox B, authority journal B and renewal readings C
  each add rows to the same table, in any order.
- **Every `LadderConditionInputs` literal in the tests gains `'shared-user'`.** That includes eleven in the ladder actor
  and route test files, which run 3296 holds; they were edited under the coordinator's ruling of mail 30748.
- **README.md's hunk** (the agent security model's "Host report" bullet) matches the acknowledged holder consent for
  the corrected packet, SHA-256 `5637df479c3bfe68c6ff33a1ade7ad79e14ce2e6bdb6f6b6d13703411b8ee96a`.
  The approved branch delta, SHA-256 `9c358e5c8a97cd2e1bd490ccbd97fb6c05819cd641230583a41f5cd8a44d2e40`,
  also matches the hunk by reverse-apply check. With no report, isolation cannot be proven, but another measured fact
  can still establish `shared-user`. The second fix round did not edit README.md or change claim ownership.
- **No live host reads in link tests.** The shared harness supplies synthetic peer seams and host roots. Existing
  direct link tests also inject the shared peer fixture wherever they can receive a ready. The deliberate no-seam
  control verifies that the client measures nothing in its absence.
- **Call-site pins** (the plan's Global Constraints, added in the review's fix round, F2): `readHostReport` and
  `measurePeer` only in the client's ready handler, `measureServerFacts` once at boot, `isolationWord` only in the reader,
  `IsolationWordLog` made only by `wireIsolation`, which index.ts calls once, and `realPeerSeams` only in the composition
  root. Each was proved by a stray second caller added from a saved copy.
- **Mutation floors.** Eight sets in `server/test/sim/isolationSets.ts`, 72 mutants, every one killed (floor 1). H16
  removes the resolved-ancestry guard; H17 hides measured exposure behind an unmeasured UID. Fixture-only adapter
  checks fail if absence and measurement errors are collapsed in either direction, or if code-root discovery skips a
  failed marker measurement. The agent, ready-handler and ladder mutations from the plan each failed their own checks.
