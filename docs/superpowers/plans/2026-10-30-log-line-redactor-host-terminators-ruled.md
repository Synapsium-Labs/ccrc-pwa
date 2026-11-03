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

**Third round, same PR, same ruling.** Review found three more shapes that printed a secret whole:

1. A port followed by more than one '.', '!' or '}', or by one of them and then another terminator (`connecting to
   tok@host:8443... retrying`, `dial tok@host:8443.) retrying`, `error: "dial tok@host:8443."`, `tok@host:8443}.`,
   `reach tok@host:8443!! now`). Rule 2 now ends at a run of '.', '!' or '}' when any of its other terminators or the
   end of the text follows the run. A version such as `x@h:1.2`, `v pkg@h:1.2.3 ok` or `see a@b:3.x` still stays
   whole in the default mode, because a digit or a letter follows its '.'.
2. A backtick around the token (`` failed to reach `tok@host:8443` (refused) ``, `` see `user@host:8443`. ``). A token
   may now start after a backtick, in rule 2, in the '/'-ended rule and in bare-host's rule, and a backtick ends rule
   2's port. The backticks stay in the output (`` `host:8443` ``).
3. A leading '@' before a userinfo whose host a '/' ends (`@tok@host/x refused`), or, in bare-host mode, the end of
   the text (`@tok@host`). The '/'-ended rule and bare-host's rule now allow any number of leading '@'s, as rule 2
   already did. In bare-host mode a handle such as `@alice@example.social` at the end of the text now reads
   `example.social`; the default mode leaves it whole.

**Corpus, third round.** 14 more `R8` rows, 2 `R1` rows (`` see `tok@host/x` now ``, `@tok@host/x refused`), 1 `R6`
row (`@tok@host`), 1 `prose` row (`v pkg@h:1.2.3 ok`) and 1 `blast` row (bare-host's `see a@b:3.x`). The six
`known-limit` rows are unchanged. Red first: 17 of 173 before the change, 173 of 173 after. The region in
`ccd/ccd-update-sync` was regenerated with `node shared/hook-helpers.mjs --write ccd/ccd-update-sync ccd/ccrc`.

**Fourth round, same PR, same ruling.** Review found one more shape that printed a secret whole in all three modes,
and asked that every gap left be named:

1. A scheme URL whose userinfo starts with '@' (`https://@tok@host/x`, `https://@tok@host`, `https://@@tok@host/x`).
   The scheme rule now takes any leading '@'s with the userinfo (`:(/+)@*[^/@?#[:space:]]+@`), so these read
   `https://host/x` and `https://host` in every mode. Each pass still drops at least one '@', so the loop ends.
2. A bracketed host that holds an IPv6 zone id or is an IPvFuture literal (`tok@[fe80::1%25en0]:80 refused`,
   `tok@[v1.fe80::1]:80 refused`). Rule 2's bracket now takes `[0-9A-Za-z:.%_~-]`. Widening it moved no existing row;
   its cost is one `blast` row, `log@[core:io]:2 ok`, which now reads `[core:io]:2 ok`. A bracket with no ':', as in
   `ref@[main]:2 ok`, was already read as an ordinary host, and a second `blast` row records that.

**The known limits** (as the sixth round below left them). Seventeen `known-limit` rows, each with a note and printed
whole in every column, and the file's own note name what this PR does not close. The CONTROL test pins exactly these
seventeen:

- a userinfo inside a query string or a path: `https://h/x?proxy=user:secret@host`, `GET /p?u=user:secret@host:8443`,
  `dir/user:secret@host`;
- a raw '#', '?' or '/' inside a password: `user:pa#ss@host refused`, `user:pa?ss@host refused`,
  `user:pa/ss@host refused`;
- a token-only userinfo (no ':') before a host that no port (or an empty one, as in `tok@h: refused`) and no path
  follows, while more text follows the host: `--proxy=tok@host refused`, `--proxy tok@host refused`. Prose's `user@host` has the same shape, and bare-host's rule
  masks it only at ')' or the end of the text;
- a port followed by a letter, '-', '_' or '~' while more text follows: `tok@host:8443-x retrying`,
  `tok@host:8443- x`, `tok@host:8443a x`, `tok@host:8443_x y`, `tok@host:8443~ x`. A host name holds those characters,
  so the text after the ':' is arguably not a port at all. Bare-host's rule still masks the shape when the token runs
  to the end of the text;
- a port followed by a run of '.', '!' or '}' and then a letter, while more text follows: `tok@host:8443.x retrying`,
  `tok@host:8443!x retrying`, `tok@host:8443}x retrying`;
- a token-only userinfo before a host of digits only and its port: `tok@2130706433:80 x`, which reads as a time's
  `build@10:30`.

The fourth round's list ended with a port followed by a non-ASCII punctuation mark (`tok@host:8443… x`,
`tok@host:8443” x`); the fifth round closed it, and those two rows are `R8` rows now.

**Bound, fourth round.** A second `bound` row keeps a head dense with masks: about 98 KB of ` u:secret@h:1` three
times and then ` /home/u/x`, so the 4001-byte head masks 244 credentials and 81 homes. BOUND now checks both rows
against the same 3 s limit in every column, and that one of them masks at least 200 credentials and 50 homes, so the
Linux CI legs measure a dense row against it. Locally it returns in under 0.1 s a call.

**Corpus, fourth round.** 7 more `R8` rows, 2 `blast` rows, 4 `known-limit` rows and the dense `bound` row. Red
first: 8 of 187 before the change (the 7 `R8` rows and `log@[core:io]:2 ok`), 187 of 187 after.

**Fifth round, same PR, same ruling.** Review found that the fourth round's list was not complete. Rule 2's port
terminator was a list of what may follow a port (whitespace, `)`, `]`, `,`, `;`, `:`, `|`, a quote, a backtick, `<`,
`>`), so a token-only userinfo before a port that anything else followed printed whole: non-ASCII whitespace
(`proxy tok@host:8443<U+00A0>x`, `<U+3000>`), an invalid byte, ASCII `(`, `&`, `\`, `=` and more, an escaped JSON quote
(`"msg":"proxy tok@host:8443\" refused"`) and a literal backslash-n (`connect to tok@host:8443\nretry`). Several of
those printed whole in all three modes, the rest in plain mode, which every ccd/ccrc caller uses.

Rule 2 now lists the bytes that do NOT end a port: both of its terminator classes are `[^0-9A-Za-z.!}_~-]`, which `LC_ALL=C`
reads byte by byte, so every other byte ends it, a non-ASCII one included. The `.`, `!` and `}` run before a
terminator or the text's end is kept, so a version's `x@h:1.2`, `v pkg@h:1.2.3 ok` and a time's `build@10:30` stay
whole in plain mode. No `blast` or `prose` row moved.

**Corpus, fifth round.** 10 more `R8` rows (two non-ASCII spaces, an invalid byte as `inputHex`, `(`, `&`, `\`, `=`,
two escaped JSON quotes and a literal `\n`), the two non-ASCII `known-limit` rows moved to `R8`, and 5 new
`known-limit` rows for a port followed by a letter, '-', '_' or '~'. Red first: 12 of 202 before the change, 202 of 202
after. The red commit's expected value for `proxy=\"tok@host:8443\" failed` was corrected in the fix commit to what the
redactor prints, `host:8443\" failed`: the token starts at the text's start, and a token-only userinfo keeps no
`KEY=` prefix (the prefix rule asks for a ':' userinfo), so the userinfo is `proxy=\"tok@`. The secret is gone either way.

**Sixth round, same PR, same ruling.** A scheme's '/' may now follow a '\', as JSON escapes it, and stays as written:
the scheme rule is `:((\\?/)+)@*[^/@?#[:space:]]+@`, its userinfo class unchanged, so `https:\/\/u:secret@host\/x`,
`https:\/\/tok@host` and `"url":"https:\/\/u:secret@host"` mask in every mode (three `R8` rows), and each pass still
drops at least one '@'. Four `known-limit` rows join the list above (a '.', '!' or '}' run and then a letter after a
port, and a host of digits only), and `_upd_redact`'s OUT OF SCOPE comment names curl's credential flags (`-u` /
`--user` / `--proxy-user user:pass`). Red first: 3 of 209 before the change, 209 of 209 after. The coordinator ended
the regex rounds here: the shapes that still print a secret are the labelled known limits above.
