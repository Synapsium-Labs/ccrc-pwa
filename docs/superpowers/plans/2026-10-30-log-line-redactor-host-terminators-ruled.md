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

**Second round, same PR, same ruling.** Review found four more shapes that printed a secret whole, in every column:

1. A port followed by '.', '!' or '}' (`reach tok@host:8443.`, `tok@host:8443! retrying`, `tok@host:8443}`). Rule 2 now
   also ends at one of those three when whitespace or the end of the text follows it, so a version such as `x@h:1.2`
   stays whole.
2. A bracketed IPv6 host (`tok@[::1]:8443 refused`, `tok@[fe80::1]:443 refused`, `tok@[::1]:8443` at the end of the
   text). Rule 2's host may now be `[` hex digits, ':' and '.' `]`.
3. A leading '@' before a token-only userinfo (`@tok@host:8443 refused`). Rule 2 now allows any number of leading '@'s.
4. A percent-encoded ':' in the userinfo (`user%3Asecret@host refused`). Rule 1 reads `%3A` and `%3a` as ':'.

Two smaller changes keep context or bound the cost:

- A ':' userinfo after `KEY=` or `--flag=` keeps that prefix, so `CCRC_X=user:secret@host` reads `CCRC_X=host` and
  `--proxy=user:secret@host:8080` reads `--proxy=host:8080`. The prefix is a letter or '_' and then letters, digits,
  '_' or '-', and the userinfo after it may not start with ':' or '='. So a base64 name's padding
  (`dG9rZW4=:x@host`) is not read as a prefix, and the whole userinfo goes. A token-only userinfo never keeps a prefix.
- Every loop rescans the whole text for each credential it masks, and the home walk does the same for each home it
  finds, so a line of 85 KB took about 9.5 s a call. A text over 4096 bytes now keeps only a head: its first 4001
  bytes, cut back to their last whitespace, so every token kept is whole and masks as it would have. A note
  `[cut: N more bytes withheld, over the redactor's 4096-byte cap]` replaces the rest. Head and note fit in 4096
  bytes, so a second pass cuts nothing more. Under the cap the worst shape measured takes about 0.12 s.

**Corpus, second round.** 13 more `R8` rows (12 of them red before the change), 2 `prose` rows, 5 `blast` rows that
record the remaining over-masking (`npm:pkg@1.2.3`, `WARNING:root:bob@example.com`, `stash@{0}:3`,
`claude-session@x.service:12`, and bare-host's `x@h:1.2`), and a `bound` row of about 85 KB written as `inputRuns`
with a BOUND test (each call under 3 s, no secret, at most 4096 bytes). Six `known-limit` rows, each with a note, and
a note at the head of the file record what this PR does not close: a userinfo inside a query string or a path
(`https://h/x?proxy=user:secret@host`, `GET /p?u=user:secret@host:8443`, `dir/user:secret@host`) and a raw '#', '?' or
'/' inside a password. The CONTROL test pins exactly those six. Red first: 14 of 154 before the change, 154 of 154
after.
