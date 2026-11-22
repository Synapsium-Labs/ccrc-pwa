# Follow-up usage-user-agent: the usage poll says the Codex client version

A task note for the programme ledger (model-class-advance, follow-up of wave 2, ticket `usage-user-agent`, epic
`catalogue-current`, checkpoint `catalogue-lists-current`). The coordinator folds what it needs into
[the ledger](../model-class-advance.md); this file is not the ledger. The wave's plan is
[the wave 2 plan](../../plans/2026-11-18-model-class-advance-w2-client-version.md), whose D-8743 makes the catalogue
probe ask as the published Codex client release, never below a shipped floor. Its one departure here, D-8781, is
defined in that plan's "Deviations found". Fix round 1 (review 2825) is folded into the sections below.

## What landed

- **One owner of the version.** The Codex auth library, `ccd/ccgpt-auth.py`, now holds the client version in one
  section of its own. These have no other copy in shipped code:
  - the floor, `CLIENT_VERSION_FLOOR`;
  - the release cache's name, path and reading (`CLIENT_RELEASE_NAME`, `client_release_path`, `read_client_release`);
  - the one place the floor is applied, `client_version`, and the cached version, `cached_client_version`;
  - the user-agent's form, `client_user_agent`.
- **One argued exception: the poll's `_UNVERSIONED_USER_AGENT`.** It is the user-agent's form with version `0.0.0`,
  sent only when the library lacks the version reader.
- **The version's grammar has two other copies, each for a reason:**
  - The library's `CLIENT_VERSION_RE` is the grammar on the box.
  - The probe's normaliser runs on the box's python3, loads no library, and checks the value it is handed.
  - `shared/models.mjs`'s `isPlainVersion` is the server's reader, in another language. Its comment now says so; it
    used to say the probe applied the bound in its own language.
- **The catalogue probe** (`ccd/ccrc-models-probe`) no longer carries `CODEX_CLIENT_VERSION`. Its request program
  applies the floor through the library and builds its user-agent with it. Its release lookup is still the cache's one
  writer, but it reads the cache through the library: the library's path is the lookup's third argument.
- **The usage poll** (`ccd/ccgpt-usage.py`) sends `codex_cli_rs/<version> (Unknown 0; unknown) unknown` on both modes,
  where the version is the cached release, never below the floor. The originator (`codex_cli_rs` or `ccrc`) and every
  other header are unchanged. The poll reads one small file and asks no network for the version.

## Why the auth library is the owner

The probe and the poll already load `ccgpt-auth.py` by path, on every box where either runs. So the shared reader
needs no new file to install, and the two programs cannot drift apart.

A new sixth GPT-lane file would have needed four other changes: the installer's lane gate, the uninstall list, the
deploy fallback, and the doctor's `CODEX_LANE_BINS`. That last list lives in `ccd/ccrc-doctor-checks`, a file of #2943
that this work may not touch.

The library is under a growth cap of 1737 code lines. With the new section and fix round 1 it measures 1727. The
review observed that the library now has two reasons to change: credentials, and the Codex client identity. A label
on the section keeps them apart. The clean end state is the section in its own lane file, once #2943 no longer holds
the doctor's list.

## An older auth library

These are mismatched-install cases, possible only in the seconds between placing the tree and placing the lane files.

- **The probe** checks every library name it calls when it loads the library: the four credential readers, plus
  `client_release_path`, `client_version`, `client_user_agent` and `CLIENT_VERSION_RE`. An older library now gets the
  probe's named `auth-library-absent` refusal, naming the missing name's class (`AttributeError`). The probe reads no
  credential, sends nothing and runs no lookup. Before fix round 1 the probe got as far as the version and stopped on
  a traceback.
- **The release lookup** loads the library inside its catch-all. If the library does not load, or lacks a name, that
  is a failed try: `triedAt` and `lastError` (`the auth library could not be loaded (<class>)`) are recorded, nothing
  is printed, npm is not asked, and the request asks as the floor. Without a reader nothing reads the cache, so the
  try is recorded over the cached release. That needs a library swapped between the request program's load and the
  lookup's.
- **The usage poll** keeps publishing, and sends `codex_cli_rs/0.0.0`.

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

The read opens with `O_NONBLOCK`, so a FIFO with no writer is not waited on. The descriptor is closed on every path:
the first shape leaked one descriptor per read of a directory, measured 50 in 50 (review 2825 F7). One poll runs with
`curl` and `npm` poisoned first on PATH, and calls neither.

## Departures

- **D-8781 (was `floor-home-auth-library`).** It is defined in the wave 2 plan. The floor, the cache's path and its
  reading moved from the probe into the auth library. The probe's constant and its cache-path variable are gone.
  - **HOME unset:** the probe still stops at its first `$HOME` read under `set -u`, before the arm (code reading). The
    usage poll's read then takes the account's home, as Python's `expanduser` reads it.
  - **Test changes that follow from the move.** No assertion on the probe's behaviour changed:
    - the client-version describe reads `FLOOR` off the library;
    - the request program's recorded environment no longer carries `CODEX_CLIENT_VERSION`;
    - the lookup's direct runs pass the library as a third argument.
- **`spec-floor-name`: no longer a departure.** The registry spec's D-8743 amendment now names the library's
  `CLIENT_VERSION_FLOOR` as the floor.
- **`fixture-env-name`.** `server/test/codexLaneFixture.ts` still records a `CODEX_CLIENT_VERSION` variable. Nothing
  sets it any more, so it records nothing. It is left alone, by the coordinator's ruling.

## Guards (each measured red against a mutant, then restored)

| Mutant | Reds |
|---|---|
| The floor not applied | a release below the floor gives the floor |
| The cache opened blocking | a FIFO at the path gives the floor (the poll hung) |
| The size cap removed | a cache over its cap gives the floor |
| The poll sends the old user-agent always | both modes say the cached release |
| The poll's fallback removed | a library without the version reader still publishes |
| `CODEX_CLIENT_VERSION="0.170.0"` back in the probe | the floor's value is spelled once |
| A second copy of the floor in the usage poll | the floor's value is spelled once |
| A floor-valued variable of another name in the probe | the floor's value is spelled once |
| The cache's file name spelled in the usage poll | the cache's name is spelled once |
| A second user-agent literal in the usage poll | the form stands in the poll on its fallback line only |
| The user-agent's form spelled in the probe | the form is spelled in the library and that one line only |
| The probe's loader back to the four old names | an older library gets the named refusal |
| The lookup re-raising a library that fails to load | the failed try is recorded (two cases) |
| The user-agent's form changed in the library | the probe's whole user-agent is pinned |
| The usage poll running `curl` | the poll asks neither curl nor npm |
| The read's first open-and-wrap shape | the read closes what it opens |

The spelling guard (`server/test/single-definition/late-census.test.ts`) matches each copy as fixed text. It does
not red:

- a floor under another value or spelling;
- a second copy of the grammar, which has two argued copies.

One equivalent mutant is not pinned. If the `S_ISREG` check is removed, every case stays green. With the read not
blocking, a FIFO reads as empty and a directory read raises, and both end as an absent cache anyway. The check stays
as the plain statement that only a regular file is the cache.

## Suites the review could not settle (fix round 1, each run alone)

- **The history recall suite:** green alone, 282 passed, in about six minutes.
- **The install-landing suite:** one case red, "ends with doctor, and a fresh box ends green". This box's doctor
  warns `browser-mcp` because a Claude Code process on this host runs a browser tool server. The same case is red
  the same way at the base, `51ab7b589`, run alone from a copy of that commit's tree. This is host state; the change
  does not cause it.

## Landing

The Codex bridge's check week, until 2026-11-21, reads the usage units every day, so this change lands only after that
week closes. The coordinator lands it.
