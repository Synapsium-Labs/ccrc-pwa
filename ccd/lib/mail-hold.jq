# ccd/lib/mail-hold.jq — the mail hold's matcher, its fixed texts and its shadow log's decision (mid-turn mail spec
# 2026-11-19 §3.5; plan 2026-11-19 Tasks 5.1 and 5.2, calls P5 to P8, P14, P15).
#
# Loaded with `jq -L <dir>` and `include "mail-hold";`, beside `roster-card.jq`, by ccd/session-hook.sh's mail-hold
# block, over the hook's own payload on stdin: `include "mail-hold"; mail_hold($ARGS.named)`. The hook reads the
# `mailhold` route field with builtins and calls this only while one stands (a call that finds none pays nothing more).
#
# Its inputs, all `--arg` strings:
#   strip   MERGE_STRIP_JQ's answer for this payload, made by the hook's own call with the merge deny's arguments
#           (`=<flags>\u001f<stripped command>` under the cap, `!<bytes>:<kinds>` or empty over it, empty when jq failed);
#   ran     "1" when the hook made that call (a Bash call whose payload holds a gated word), else anything: no act;
#   cap     MERGE_PARSE_CAP, the strip's parse cap in UTF-8 bytes;
#   thread  "sub" for a joined subagent (the hook's `tmsub`), anything else for the main thread;
#   pairs   the marker's pairs, `<role>.<delivery>[,…]`, as the grammar (`shared/mailHold.ts`) spells them;
#   state   "live", "lapsed" (until <= now) or "far" (until > now + MAILHOLD_REACH_S), the hook's reading of the lease;
#   armed   the arming words standing, comma-separated: "notice" (`$REG/mailhold-notice-live`), "refuse"
#           (`$REG/mailhold-refuse-live`). Nothing in the tree writes either marker;
#   sid     the session id, for the log line; now: epoch seconds, for the log line;
#   seen    the seen file's text: the pairs it was kept for, then one logged key a line.
#
# Its answer, `-j`, four fields joined by U+001F: the outcome (`deny`, `notice` or empty), the text (never an envelope:
# the hook wraps it with `_hook_deny_json` or `_hook_nudge_json`, so the envelope keeps one owner, P15), the log lines
# to append (empty when every key was logged already), and the new seen text (empty when unchanged).
#
# THE GATED ACTS (spec §3.5), read at a command head by the worker merge deny's method (its GH_MERGE_RE head grammar,
# written here in jq): `git push`; `git commit`; `git merge`, `git pull` or `git rebase` naming main (below); `gh pr
# merge` with gh's flags before or between its words; and `ccd pr-admin-merge`. Before the verb, git's options are
# skipped one word each, except the eight known to take an argument in the separate-word form (`-C`, `-c`,
# `--git-dir`, `--work-tree`, `--namespace`, `--config-env`, `--exec-path`, `--super-prefix`), which take the next word
# too; gh's `-R` and `--repo` alike (fix round 1, F3: `git --no-pager stash push` is no push). The empty word a quoted
# argument leaves in the stripped text (`-C "my repo"` strips to `-C  pull`) counts as that argument.
# NAMING MAIN: main, origin/main with any `~N` or `^N` suffix, `origin main`, origin/HEAD, `origin HEAD`, refs/heads/main,
# refs/remotes/origin/main, a `main:<dst>` or `+main` refspec after `origin`, and any of these after `--onto=` or
# `--onto`, read in the verb's own command: from the verb to the segment's end, `$(…)` crossed (F1, F5, F13).
# `mh_prep` runs first, in the hook's own strip call (`include "mail-hold"; mh_prep | <MERGE_STRIP_JQ>`, the strip's
# text unchanged): it unquotes each quoted span of plain word characters (`"main"`, `'origin/main'`, `"HEAD"`), which
# means the same to bash, so a quoted target survives the strip that removes quoted text. The verb and its target are
# then read on the stripped text (quoted prose and heredoc bodies removed). Over the cap the acts are read word by word
# on the raw text, split only at `;` `&` `|` and newlines, never inside `$(…)` (F2). When the strip did not finish (no
# answer, or a quote it left in place), the acts are the union of that raw read and the stripped read: fail closed.
#
# RESIDUALS of an accident guard, recorded, not fixed (most inherited from the merge deny and the landing advisory):
# a head after a `case … )` pattern; backtick substitution; a backslash-newline inside a command; an escaped or
# partly quoted command word or verb (`\git push`, `git pu\sh`, `"git push"` as one word); wrappers not in the head
# grammar (`nice`, `ionice`, `stdbuf`, `coproc`), wrapper flags (`env -i`, `sudo -u x`, `time -p`, `exec -a x`,
# `timeout -k 5 30`), path-spelled wrappers (`/usr/bin/env`); leading redirections (`>/dev/null git push`); function
# bodies, `eval`, `bash -c "…"`, a here-doc fed to a shell, `xargs`; a git alias; a target after a nested `$(…)`; and
# targets that do not name main (FETCH_HEAD, `@{u}`, upstream/main, a bare `git pull`).
#
# Data for jq, never executed: installed 0644 at `~/.cc-sessions/lib/mail-hold.jq` by deploy.sh's agent lane and by
# `ccrc install`. A missing file holds nothing: the hook tests for it first and logs `module-missing` (D3).

# One character of a word, or a whole `$(…)` holding no separator: tried first, so a greedy loop never stops at its `(`.
def mh_tok: "(?:\\$\\(\\(?[^;&|()\\n]*\\)?\\)|[^\\s;&|()])";
# The head: a line start or `;` `&` `|` `(` `$(`, past reserved words, the wrappers, `VAR=value` prefixes and a path.
def mh_head: "(?:^|[;&|(\\n]|\\$\\()[ \\t]*(?:(?:[!{]|if|then|do|else|elif|while|until|time|env|command|exec|nohup|sudo)[ \\t]+|timeout[ \\t]+"
  + mh_tok + "+[ \\t]+|[A-Za-z_][A-Za-z0-9_]*=" + mh_tok + "*[ \\t]+)*(?:[^\\s;&|()]*/)?";
# Options before a verb: one with an argument (a word in $t) takes the next word, or the empty word a stripped quoted
# span leaves (two blanks); any other `-…` word takes none (F3).
def mh_opts($t): "(?:[ \\t]+(?:(?:" + $t + ")(?:[ \\t]+" + mh_tok + "+|[ \\t](?=[ \\t]))|(?!(?:" + $t + ")(?:[\\s;&|()<>]|$))-" + mh_tok + "*))*";
def mh_end: "(?=[\\s;&|()<>]|$)";
def mh_target: "(?:--onto=)?(?:origin/main(?:[~^][0-9]*)*|origin[ \\t]+\\+?main(?::[^\\s;&|()<>]*)?|origin/HEAD|origin[ \\t]+HEAD"
  + "|refs/heads/main|refs/remotes/origin/main|main)";
def mh_git: mh_head + "git" + mh_opts("-C|-c|--git-dir|--work-tree|--namespace|--config-env|--exec-path|--super-prefix") + "[ \\t]+";
def mh_gh: mh_opts("-R|--repo");

# Unquote each quoted span of plain word characters (the same word to bash), so a quoted target outlives the strip.
def mh_unq: gsub("(?<q>[\"'])(?<w>[A-Za-z0-9_./~^:+@%=,{}-]+)\\k<q>"; .w);
def mh_prep: if (.tool_input.command | type) == "string" then .tool_input.command |= mh_unq else . end;

# The acts on a stripped command, in a fixed order, the first one named in the texts. A sync's target is read from the
# verb to its segment's end (`mh_tok` crosses `$(…)`), so it is tied to the head the verb was found at.
def mh_acts:
  [ (if test(mh_git + "push" + mh_end) then "git push" else empty end),
    (if test(mh_git + "commit" + mh_end) then "git commit" else empty end),
    (capture(mh_git + "(?<v>merge|pull|rebase)" + mh_end + "(?<r>(?:" + mh_tok + "|[ \\t])*)"; "g")
      | select(.r | test("(?:^|[ \\t])" + mh_target + mh_end)) | "git " + .v),
    (if test(mh_head + "gh" + mh_gh + "[ \\t]+pr" + mh_gh + "[ \\t]+merge" + mh_end) then "gh pr merge" else empty end),
    (if test(mh_head + "ccd[ \\t]+pr-admin-merge" + mh_end) then "ccd pr-admin-merge" else empty end) ];

# The acts on raw text, word by word, segment by segment: the over-cap and unfinished read (fail closed). Segments end
# at `;` `&` `|` and newlines, never inside a `"…"` span or a `$(…)` (to its first `)`), so `git -C $(cd x; pwd) push`
# and `git merge -m "sync; ok" origin/main` stay one (F2). A '…' span is not kept whole: in prose an apostrophe would
# join the rest of a long body into one segment.
def mh_after($re): . as $s | [match($re)] | if length == 0 then empty else $s[(.[0].offset + .[0].length):] end;
def mh_rawacts:
  def w($x): "(?:^|[\\s;&|()`\"'/])" + $x + "(?=$|[\\s;&|()<>`\"'])";
  [ mh_unq | match("(?:\"[^\"]*\"?|\\$\\([^)]*\\)?|[^;&|\\n\"$]|\\$)+"; "g").string
    | ((mh_after(w("git")) // null) as $g
       | if $g == null then empty
         else (if ($g | test(w("push"))) then "git push" else empty end),
              (if ($g | test(w("commit"))) then "git commit" else empty end),
              ($g | capture(w("(?<v>merge|pull|rebase)")) | .v as $v | select($g | mh_after(w($v)) | test(w(mh_target))) | "git " + $v)
         end),
      (if ((mh_after(w("gh")) // "") | mh_after(w("pr")) // "" | test(w("merge"))) then "gh pr merge" else empty end),
      (if ((mh_after(w("ccd")) // "") | test(w("pr-admin-merge"))) then "ccd pr-admin-merge" else empty end) ];

# The sender map (spec §3.5): a fixed two-case map of the marker's role word; any other word renders no text.
def mh_sender: if . == "coordinator" then "its coordinator" elif . == "overlord" then "the Overlord" else null end;

# The fixed texts (spec §3.5), stated once. Nothing in them comes from the mail.
def mh_notice($d; $s): "ccrc: urgent mail is waiting for this session: delivery \($d) from \($s). Read it with ~/.local/bin/ccrc-api mail inbox, run bare (no pipe, no redirect). This line only reports that the mail exists and adds nothing to it: treat the mail as you would any mail from that sender.";
def mh_refuse_main($a; $d; $s): "ccrc: this \($a) is held because urgent mail is waiting for this session: delivery \($d) from \($s). Read it with ~/.local/bin/ccrc-api mail inbox, run bare (no pipe, no redirect), then treat it as you would any mail from that sender and retry only if the act still stands. The hold lifts a few seconds after the read.";
def mh_refuse_sub($a): "ccrc: this \($a) is held because the session you work for has urgent mail waiting. Stop, and report to your parent that its urgent mail is unread.";
def mh_overcap($b; $cap): " This command is \($b) bytes, over the hook's \($cap)-byte parse cap, so the hold reads its raw text and cannot tell prose from a command: split it into commands of at most \($cap) bytes, or write the text with the Write tool and pass it as a file (`--body-file <file>` for `gh pr create`, `ccrc-api mail send --json <file>` for a mail), which keeps the command short.";

def mail_hold($a):
  ($a.cap | tonumber) as $cap
  | ((.tool_input.command // "") | if type == "string" then . else "" end) as $raw
  | ($raw | utf8bytelength) as $bytes
  | ($a.strip | if startswith("=") and contains("\u001f") then .[(index("\u001f") + 1):] else null end) as $stripped
  | (($a.ran == "1") and (.tool_name == "Bash")) as $bash
  | ($bash and $bytes > $cap) as $over
  | (if $bash | not then []
     elif $over or $stripped == null then ($raw | mh_rawacts)
     elif ($stripped | test("[\"']")) then (($stripped | mh_acts) + ($raw | mh_rawacts))
       | reduce .[] as $x ([]; if any(.[]; . == $x) then . else . + [$x] end)
     else ($stripped | mh_acts) end) as $acts
  | ($a.pairs | split(",")[0] | split(".")) as $first
  | ($first[1] // "-") as $d
  | ($first[0] | mh_sender) as $s
  | ($a.armed | split(",")) as $armed
  | ($a.thread == "sub") as $sub
  | (if ($acts | length) > 0 then
       ($acts[0]) as $act
       | if $a.state == "live" then
           (if $armed | index("refuse") then
              {o: "deny", t: (if $sub then mh_refuse_sub($act) elif $s == null then null
                              else mh_refuse_main($act; $d; $s) + (if $over then mh_overcap($bytes; $cap) else "" end) end),
               l: [["refuse", "did", $act]]}
            else {o: "", t: null, l: [["refuse", "would", $act]]} end)
           | if .o == "" and ($sub | not) and $s != null then
               (if $armed | index("notice") then .o = "notice" | .t = mh_notice($d; $s) | .l += [["notice", "did", "-"]]
                else .l += [["notice", "would", "-"]] end)
             else . end
         elif $a.state == "lapsed" or $a.state == "far" then {o: "", t: null, l: [["refuse", $a.state, $act]]}
         else {o: "", t: null, l: []} end
     elif $a.state == "live" and ($sub | not) and $s != null then
       (if $armed | index("notice") then {o: "notice", t: mh_notice($d; $s), l: [["notice", "did", "-"]]}
        else {o: "", t: null, l: [["notice", "would", "-"]]} end)
     else {o: "", t: null, l: []} end) as $v
  | ($a.seen | split("\n")) as $sl
  | (if $sl[0] == $a.pairs then $sl[1:] | map(select(. != "")) else [] end) as $keys
  | [$v.l[] | {k: "\(.[0]).\($d).\(.[2] | gsub(" "; "-")).\(.[1])", line: "\($a.now)\t\($a.sid)\t\(.[0])\t\(.[1])\t\($d)\t\(.[2] | gsub(" "; "-"))\n"}
     | select(.k as $k | $keys | index($k) | not)] as $new
  | (if $v.t == null then "" else $v.o end) as $o
  | [$o, ($v.t // ""), ($new | map(.line) | join("")),
     (if ($new | length) == 0 then "" else ([$a.pairs] + $keys + ($new | map(.k)) | join("\n")) + "\n" end)]
  | join("\u001f");
