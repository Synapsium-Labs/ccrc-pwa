# Follow-up usage-user-agent: the usage poll says the Codex client version

A task note for the programme ledger (model-class-advance, follow-up of wave 2, ticket `usage-user-agent`, epic
`catalogue-current`, checkpoint `catalogue-lists-current`). The coordinator folds what it needs into
[the ledger](../model-class-advance.md); this file is not the ledger. The wave's plan is
[the wave 2 plan](../../plans/2026-11-18-model-class-advance-w2-client-version.md), whose D-8743 makes the catalogue
probe ask as the published Codex client release, never below a shipped floor.

## What landed

- **One owner of the version.** The floor (`CLIENT_VERSION_FLOOR`), the version's grammar (`CLIENT_VERSION_RE`), the
  release cache's path and its reading (`client_release_path`, `read_client_release`), the floor's application
  (`client_version`), the cached version (`cached_client_version`) and the user-agent's form (`client_user_agent`) now
  live in the Codex auth library, `ccd/ccgpt-auth.py`, in one section of its own.
- **The catalogue probe** (`ccd/ccrc-models-probe`) no longer carries `CODEX_CLIENT_VERSION`. Its request program
  applies the floor through the library and builds its user-agent with it. Its release lookup is still the cache's one
  writer, but it reads the cache through the library: the library's path is the lookup's third argument.
- **The usage poll** (`ccd/ccgpt-usage.py`) sends `codex_cli_rs/<version> (Unknown 0; unknown) unknown` on both modes,
  where the version is the cached release, never below the floor. The originator (`codex_cli_rs` or `ccrc`) and every
  other header are unchanged. The poll reads one small file and never asks npm.

## Why the auth library is the owner

The probe and the poll already load `ccgpt-auth.py` by path, on every box where either runs. So the shared reader
needs no new file to install, and the two programs cannot drift apart.

A new sixth GPT-lane file would have needed four other changes: the installer's lane gate, the uninstall list, the
deploy fallback, and the doctor's `CODEX_LANE_BINS`. That last list lives in `ccd/ccrc-doctor-checks`, a file of #2943
that this work may not touch. The library is under a growth cap of 1737 code lines. With the new section it measures
1724, so it stays under the cap.

## What the poll does with a bad cache

Each of these gives the floor, and the poll still publishes:

- no cache file;
- a release below the floor;
- a file that is not JSON, is not an object, or has no `version`;
- a version that is a prerelease or a number;
- a deeply nested file;
- a file over 262144 bytes;
- undecodable bytes;
- a directory or a FIFO at the path;
- an unreadable file.

The read opens with `O_NONBLOCK`, so a FIFO with no writer is not waited on. An auth library placed without the
version reader, for example an install caught between two files, still publishes. The poll then sends the
user-agent it sent before this change, `codex_cli_rs/0.0.0`, so the version cannot stop a poll.

## Departures (named by slug; the coordinator allocates any number)

- **`floor-home-auth-library`.** The floor moved out of the probe, where the wave 2 plan put it, into the auth
  library. Three probe-test changes follow from that move, and no assertion on the probe's behaviour changed:
  - the client-version describe now reads `FLOOR` off the library;
  - the request program's recorded environment no longer carries `CODEX_CLIENT_VERSION`;
  - the lookup program's direct runs pass the library as a third argument.
- **`spec-floor-name`.** The registry spec (`2026-09-08-model-class-registry-design.md`, around its codex row)
  still names the probe's shipped constant `CODEX_CLIENT_VERSION` as the floor. That text is now stale. It is left
  for the ledger pull request or a spec revision, because this change edits no spec.
- **`fixture-env-name`.** `server/test/codexLaneFixture.ts` still records a `CODEX_CLIENT_VERSION` variable. That
  is now harmless: nothing sets it, so nothing is recorded. It is left alone to keep the change small.

## Guards (each measured red against a mutant, then restored)

| Mutant | Reds |
|---|---|
| The floor not applied | a release below the floor gives the floor |
| The cache opened blocking | a FIFO at the path gives the floor (the poll hung) |
| The size cap removed | a cache over its cap gives the floor |
| The poll sends the old user-agent always | both modes say the cached release |
| The poll's fallback removed | a library without the version reader still publishes |
| `CODEX_CLIENT_VERSION="0.170.0"` back in the probe | the floor is spelled once (`single-definition`) |
| A second copy of the floor in the usage poll | the floor is spelled once (`single-definition`) |

One equivalent mutant is not pinned. If the `S_ISREG` check is removed, every case stays green. With the read not
blocking, a FIFO reads as empty and a directory read raises, and both end as an absent cache anyway. The check stays
as the plain statement that only a regular file is the cache.

## Landing

The Codex bridge's check week, until 2026-11-21, reads the usage units every day, so this change lands only after that
week closes. The coordinator lands it.
