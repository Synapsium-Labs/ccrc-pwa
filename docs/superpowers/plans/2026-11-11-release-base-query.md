# A release base with a query or a fragment is refused, and the redactor withholds both

- **D-8342 (2026-11-11)** — A `CCRC_RELEASE_BASE_URL` holding `?` or `#` is refused by name before any fetch in the updater too (`_upd_base_ok`, asked by `_upd_resolve` and `_upd_asset_listed`), in install.sh's words; `_upd_redact` and install.sh's `_inst_redact` withhold a scheme URL's query and fragment (`https://h/r?[withheld]`), overturning the earlier "a query or a fragment is not masked" ruling.

## Why

Both the bootstrap (`install.sh --release`) and the updater (`ccrc update`, `rollback`, `rollout`, the test box's tools
unit) append the release paths to the base: `/latest/download/SHA256SUMS` or `/download/<tag>/…`. A base such as
`https://mirror.example/r?x=1` or `…/r#f` puts those paths inside its query or fragment, so the URL fetched is one no
release host serves, and the failure names a URL whose query may carry a token. The redactor masked only a URL's
userinfo and the home directory, so such a query reached the "fetching" line, the die and `update.json` whole.

## What changed

- `ccd/ccrc`: `_upd_base_ok <base>` refuses a base holding `?` or `#` and sets `KNOB_WHY` to
  `CCRC_RELEASE_BASE_URL holds a query or a fragment, so the release paths cannot be appended to it` (the variable is
  named, the value never). `_upd_resolve` dies with it (`… — nothing on this box was changed`) before its staging
  directory or any fetch; `_upd_asset_listed` (rollback's pre-check, and arm 2's bundle question) returns its rc 3, the
  unreadable base's, so `rollback` dies with `rollback: <the sentence> — nothing on this box was changed` and arm 2 leaves
  the decision to the restore child, as it does for an unreadable base.
- `_upd_redact` (and the generated copy in `ccd/ccd-update-sync`): in both modes a scheme URL keeps its first `?` or `#`
  and loses what follows to the token's end, written `[withheld]`. Text that is no scheme URL keeps its `?` and `#`. A
  second pass changes nothing.
- `_upd_url_origin` (the settings view's `custom <origin>`): its raw screen now refuses a '?' or '#' before the last '@'
  too. It relied on the redactor leaving such an '@' in place; with the query withheld, `https://deploy:pw?x@m/r` would
  have shown `https://deploy:pw`. It reads `custom` alone, as a '/' there already did.
- `install.sh`: `_inst_redact` carries the same rule, spelled for bash 3.2 (a cut-and-join walk, no pattern
  substitution), held byte-equal to `_upd_redact` by `install-sh.test.ts` over the shared corpus under the default bash
  and `BASH_COMPAT=42`, `40` and `32`. The release arm already refused such a base (#2308); its comment no longer says the
  query is printed. The updater's sentence about curl before 8.4.0 now stands at install.sh's SHA256SUMS fetch too.
- The log-line corpus: eight rows moved to their withheld output (the `authority` and `plain` rows with a query or a
  fragment, and the known limit `https://h/x?proxy=user:secret@host`, now a `query` row: sixteen known limits are left),
  and seven rows were added (six `query`, one `prose`).

## Deviations found

- The task named both files as lacking the refusal; install.sh's release arm already refused a `?` or `#` base and
  already carried the curl 8.4.0 sentence in its knob block. The rows for `?x=1` and `#f` were added beside its existing
  `?token=…` and `#…` rows, and the sentence was repeated at the fetch, where the updater carries its own.
- `ccrc settings` still shows such a base as `custom <scheme>://<host>` (its origin view drops a query and a fragment);
  the refusal is the fetch's, where the release path is first built. A refusal in the settings view or at `settings
  set` would need a closed-set refusal word for the base, which this change does not add.
