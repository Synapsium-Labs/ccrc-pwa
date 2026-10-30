# The log-line redactor masks scheme-less userinfo whatever ends its host, ruled

## Deviations found

- **D-7564 (2026-10-30)** — the log-line redactor masks scheme-less userinfo whatever ends its host

**Why.** `_upd_redact` in `ccd/ccrc` is the one bash log-line redactor. `ccd/ccd-update-sync` carries a generated copy
of it (the log-line region, D-7078, D-7289). With no scheme it masked a userinfo only when the host was followed by
'/', '?' or '#', or, in `bare-host` mode, by ')' or the end of the text. So a credential printed whole in both modes
when its host ended in any other way. The corpus `server/test/fixtures/redact/log-line.json` recorded eight such lines
under the rule `known-limit`:

- `server user:secret@host:8443 refused` (a port and then a space)
- `user:secret@host: refused` (a bare ':')
- the host followed by `'`, by `"`, by a tab or by a CR
- `user:secret@@host/x` (a second '@')
- `@user:secret@host` (a leading '@')

The operator ruled on 2026-10-30 that the gap is to be closed now. The change is security-sensitive, so it was built
natively and not handed off.

**What changed, in both modes.**

1. A token's userinfo that holds a ':' (`user:pass@`, up to the token's last '@', with a leading '@' included) is
   masked whatever follows the host. A token starts at the start of the text or after whitespace, '"', "'", '<' or '('.
   An email address has no ':' before its '@', so it stays whole.
2. Any userinfo is masked when its host ends in `:digits` and the port is followed by whitespace, `)`, `]`, `,`, `;`,
   `:`, `|`, a quote, `<`, `>` or the end of the text: `tok@host:8443 refused` becomes `host:8443 refused`. The host
   must hold at least one character that is not a digit, so a time such as `build@10:30` stays whole.
3. The '/'-ended rule (and `bare-host`'s own rule) lets each run after the first be empty. So `tok@@h/r` loses
   `tok@@`, because curl's userinfo runs to the last '@'.

**Corpus.**

- The eight `known-limit` rows are now `R8` rows that hold their masked output, and no row carries a note any more.
- 20 new `R8` rows cover each new terminator: a port before a space, `,`, `>` or the end of the text; a bare ':'; a
  space; LF; `,`; `;`; `(…)`; `'…'`; `<…>`; `!`; the end of the text; a userinfo with no host; `@@`; a leading '@';
  and a UTF-8 locale row.
- 12 new `prose` rows hold lines that must stay whole: an email address followed by ':', ',', `'` or a tab; a systemd
  instance unit followed by ':'; three times (`10:30`, `10:30:15`, `build@10:30`); and four lines with a port and no
  userinfo (`https://h:8443/x`, `connect h:8443 refused`, `http://127.0.0.1:8443`, `[::1]:8443`).
- One value moved that the eight rows do not name: the R6 row `could not resolve host in u:hunter2@h.invalid:9)` was
  printed whole in its `ccrc` column, and that column now masks it. Rule 1 caught it.
- One `blast` row records the cost: `mailto:a@example.com` reads as `user:pass@host` and becomes `example.com`.
- Red first: before the redactor changed, the corpus test failed 30 of 126 cases (every new R8 row, the R6 row and
  the blast row). After the change all 126 pass.
- The `_upd_redact` call counts (`ccd/ccrc` 18, `ccd/ccrc-doctor-checks` 3) are unchanged. The region in
  `ccd/ccd-update-sync` was regenerated with `ccrc restamp ccd/ccd-update-sync`.

**Still out of scope.** A query-string secret and a bearer token are still not masked, as the redactor's header
says. A non-credential `user@host` that ends any way other than '/', '?', '#' or a port is still treated as prose in
the default mode.
