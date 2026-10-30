# ccd: the disk-retention code moves into a digest-checked library: Implementation Plan

> **For agentic workers:** one task, one PR (#1404, closes the ccd half of #1279). REQUIRED SUB-SKILL:
> superpowers:test-driven-development (characterize first, then move). Fixture HOMEs only.

**Goal.** The fleet disk-retention regions leave `ccd/ccd` byte-for-byte for `ccd/lib/disk-retention.sh`, which ccd
loads at its foot under a digest it pins, so `ccd/ccd` shrinks and the growth and context ratchets bind again.

**Programme:** #1167 (DR-1..DR-31). The moved regions keep their own decisions (D-6625, D-6628, D-6629, D-6632,
D-6634, D-6638).

## The decision

- **D-6913** — `ccd/ccd` loads `lib/disk-retention.sh` from beside its own location (never from the environment, an
  argument or `$HOME`): it reads the file once, hashes what it read through a pipe and evaluates what it hashed; a
  missing, linked, unreadable, unhashable or changed library refuses every start (`lib-missing`, `lib-unreadable`,
  `lib-hash`, `lib-digest`; status 125). The digest check fails CLOSED: the hashing tool is the one PATH holds, else one
  at a fixed standard location (`__CCD_HASH_TOOLS`: `/usr/bin/sha256sum`, `/usr/bin/shasum`, `/sbin/sha256`, …), so a
  stripped PATH still hashes and the verb still names what is really missing (`ccd version` names python3); only a
  system with no hashing tool anywhere refuses, with one quiet `lib-hash` line, and the library is never evaluated
  unchecked. The body pins the library's SHA-256 (`__CCD_LIB_SHA256`), and the pin gets the install-time treatment
  #1525 gave line 2 (operator ruling, 2026-10-25): the committed `ccd/ccd` carries the fixed placeholder
  `__CCD_LIB_SHA256=stamp-at-install`, never a digest, so no PR conflicts on it; `ccd/ccd-entry-install.py` computes the
  sha256 of the library bytes it publishes, renders it into the installed body BEFORE it stamps the body (so the stamp,
  and the launcher's digest of the stamped bytes, cover the pin), publishes the library first in both install lanes, and
  refuses a tree whose rendered pin is not exactly one line naming that library. `ccrc restamp ccd/ccd` stays refused.
  The publisher refuses a library that does not end in exactly one newline or that carries a NUL byte, because the body
  hashes the file as bash reads it and the publisher hashes the raw bytes.
- **Installed or source checkout.** An INSTALLED body (its line 2 a real stamp) whose pin does not match the library
  refuses with `lib-digest`; one whose pin is still the placeholder is a broken install and refuses with `lib-digest`
  too. A SOURCE CHECKOUT is the one body with BOTH the line-2 placeholder and the pin placeholder in place, which no
  installed body can be; it skips the digest check, because nothing was installed, and still refuses a missing or
  linked library (`lib-missing`).

## Ruled acceptable: the DR lines that stay inline in `ccd/ccd`

The orchestrator ruled that these stay, because moving them would rewrite pre-existing functions and this change is a
pure move: D-6640 (15 lines, the expiry child arm), D-6642 (9 lines, `ws-archive --if-no-pane`), D-6619 (the holder
probe, under its waiver row), D-6632 (44 call-site lines inside functions that stay) and D-6638 (27 lines, the stale
arm's inline halves). Follow-up #1416: list `ccd/lib/disk-retention.sh` in the growth check once this lands.
