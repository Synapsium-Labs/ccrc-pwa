# W5 C5i: the scheme-less loop's scope, ruled

- **D-7289 (2026-10-28)** — C5i's act ruled: option A, the bare-host mode passed only by ccd-update-sync's say.

**D-7289.** On 2026-10-28 the operator ruled the one act the C5i design note asks (`docs/superpowers/plans/2026-10-27-w5-c5i-design.md`, §Problem 1, "the scope of #1578's second scheme-less loop"). The ruling is **option A**, as the note recommends. The note is not edited, because merged plans are append-only, so this file is the record. C5i's build cites it.

**Option A:** `ccd/ccrc#_upd_redact` stays the one log-line redactor (OA-C12 (a)). It gains a second, optional argument, `bare-host`. Only when that argument is passed does it run #1578's second scheme-less loop, which masks a `user:password@host` written without a scheme. Only `ccd/ccd-update-sync`'s `say` passes it.

**What this means:**
- No `ccd/ccrc` or `ccrc doctor` line changes on any row: unit names, email addresses, `KEY=user@host`, `root@box` and `HEAD@{1}` keep their text.
- `ccd-update-sync`'s lines change only on R7, where more is masked, as OA-C12 (a) intends.

**Still gated:** C5i's first build commit waits for #1578 to merge, as the note requires. If #1578 closes without merging, the note is revised and reviewed again before C5i builds.
