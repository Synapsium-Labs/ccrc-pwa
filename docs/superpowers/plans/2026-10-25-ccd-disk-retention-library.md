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
  unchecked. The body pins the library's SHA-256 (`__CCD_LIB_SHA256`), `ccrc restamp
  ccd/ccd` rewrites that pin, and `ccd/ccd-entry-install.py` publishes the library first in both install lanes and
  refuses a tree whose library its body does not pin. Restamp and the publisher refuse a library that does not end in
  exactly one newline or that carries a NUL byte, because the body hashes the file as bash reads it and they hash the
  raw bytes.

## Ruled acceptable: the DR lines that stay inline in `ccd/ccd`

The orchestrator ruled that these stay, because moving them would rewrite pre-existing functions and this change is a
pure move: D-6640 (15 lines, the expiry child arm), D-6642 (9 lines, `ws-archive --if-no-pane`), D-6619 (the holder
probe, under its waiver row), D-6632 (44 call-site lines inside functions that stay) and D-6638 (27 lines, the stale
arm's inline halves). Follow-up #1416: list `ccd/lib/disk-retention.sh` in the growth check once this lands.
