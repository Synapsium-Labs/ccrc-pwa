# A count of the Python transcript readers in ccd

The operator ruled on 2026-11-06 that the Python readers in ccd stay as recorded exceptions, and that the transcript
writer stays. This is the code half of that ruling: a test that names them, so a new reader cannot join unseen.

- **D-8070 (2026-11-06)** — a count names the Python transcript readers in ccd. `server/test/ccd-python-reader-census.test.ts` holds one row per site, reds on a new reader or on a kept one going, and takes a new reader only through a row with a defined D-number and a reason. `_transcript_limit_banner` is the one row that may match nothing, so its port lands without an edit to the test and the count falls by one. The spec's line and the recorded exception are the ruling's other half.

## What the rows say

| Site | Row | Note |
| --- | --- | --- |
| `_operator_choice_read` | reader | named by the ruling |
| `_transcript_limit_banner` | reader, leaving | named by the ruling; the port is still to come |
| `ccd-usage-sweep.py` | reader | the ruling's argument names it as staying |
| `lib/carry-dedupe.py` | reader | the ruling did not name it; its `index` parses every row of a carried copy for `uuid` |
| `_sanitize_anthropic` | writer | named by the ruling |
| `_carry_py`, `cmd_carry_dedupe`, `_ws_archive_manifest` | no-read | they match the words and parse no record |
