# ccd/lib/transcript.jq — the one transcript reader on the ccd side (ARCH-65).
#
# Loaded with `jq -L <dir>` and `include "transcript";` by ccd/ccd and by
# ccd/ccrc-doctor-checks. Entry points: `continued_in($u)` (the successor a
# slurped raw tail window names, or nothing) and `last_turn_ts` (the newest real
# turn's epoch seconds in a slurped raw window, or nothing). Everything else is
# a helper. A named jq argument (`--arg u`) is not visible inside a module, so
# the uuid travels as a parameter.
#
# WHAT COUNTS AS A MARKER — ONE RULE, THREE READERS (D-4940), TWO SPELLINGS
# (ARCH-65). This module is the rule both bash readers run (`_continued_in_of`
# in ccd/ccd and `_dr_continued_in` in ccd/ccrc-doctor-checks, which cannot
# source each other, so both load this file with `jq -L`); `tailRecordOf`/`continuationInTail`
# (`server/src/transcript/parse.ts`) is the same rule in TypeScript, where the
# rule is written out in full. `server/test/continued-in-parity.test.ts` runs
# all three readers over one table of transcripts. In short: the window's lines are read NEWEST FIRST; a
# top-level `continued-in` record decides (a successor, or none when it is not
# this file's valid marker), a top-level user/assistant record that Claude
# Code's own reader calls a finished turn decides "none", and every other
# line — re-stamped metadata, an interruption notice, a tool result, a
# streamed record with no `stop_reason` yet, a line that does not parse, the
# window's cut first line — is stepped over.
#
# JQ, NOT A BASH PATTERN, AND WHY (review finding F1). The old reader matched
# substrings anywhere on the last line, so a tool call whose INPUT held a
# marker-shaped object, with the record's own top-level `sessionId` late on the
# line, read as a marker: ccd wrote the registry to a session the operator was
# not in while the server, which parses, refused it. Deciding the MARKER exactly
# in bash is possible (it is a flat object); deciding that a nested line's own
# top-level `type` is user or assistant is not, short of a JSON parser. Cost:
# one `jq` beside the one `tail`, and both run only once per quiescence (the
# read budget below), never per tick. A box with no jq follows nothing — no
# output is "no successor" — and `ccrc doctor`'s jq check FAILs that box.
#
# A FINISHED TURN, AS CLAUDE CODE TELLS ONE (`complete`, `prompt`). Its own
# reader (2.1.296) steps over every user/assistant record that is not one: an
# assistant record whose `stop_reason` is not a string or that is an API
# error, and a user record that is meta, a compact summary, a tool result, or
# whose every text is empty, a slash command's echo, a leading tag
# (`<local-command-stdout>`, `<system-reminder>`, …) or an interruption
# notice. Stopping at those as well declined a follow Claude Code makes, and
# those are the records most likely to land after a busy session is forked.
# `jstrim`/`jsws` are JavaScript's `trim()` and `\s`, code point for code
# point, and `tagled`/`cmdname` are its two patterns, so the test is the same
# on the same string. Claude Code turns every newline into a space before
# testing; here that step is folded into the tests instead (both treat a
# newline exactly as a space: whitespace to `jstrim` and `tagled`, and NOT a
# place `cmdname`'s `.` stops — it stops at `\r`, U+2028 and U+2029 only).
# The one place this rule stops where Claude Code might step over is a text
# holding a `<pasted_content id="` literal, which Claude Code unwraps first
# and this program does not.
#
# NO `first`, `limit`, `any`, `all`, `isempty` OR `label` (review of D-4940,
# measured): on jq 1.6 a `try` swallows the `break` those are built on when it
# sits between the label and the break, so `first(… try fromjson …)` emitted
# EVERY deciding line, and the older marker behind a user turn won. Two
# guards now, either of which alone holds on jq 1.6 (both measured): every
# decision is collected into an array and the newest taken from it, so there
# is no break to swallow; and each parse's `try` sits inside its own array
# constructor, so no break could cross it. The parity test pins the first by
# spelling, and runs the table on every jq it finds.
#
# The uuid test is `explode`d character classes, not `test()`: jq's `$` also
# matches before a trailing newline (a successor `"<uuid>\n"` would pass
# `^…$`), and a jq built without Oniguruma has no `test()` at all.
#
# jq and `JSON.parse` agree on every line a JSON serializer writes but two,
# measured on jq 1.6, 1.7.1 and 1.8.2. A LONE SURROGATE ESCAPE (`"\ud83d"`,
# what `JSON.stringify` writes for a string cut mid-emoji) is refused by every
# jq; `unsurrogate` rewrites each surrogate escape into a plain one and parses
# again, which changes no decision this program makes (none reads a character
# that is not ASCII or whitespace). NESTING DEEPER THAN 256 is refused by jq
# before 1.8, and is left as it is: such a line is skipped here while the
# server reads it, so a finished turn nested that deep after a marker is one
# this reader steps over and the server stops at — recorded, not pinned,
# because which jq refuses it is the variable. The surrogate row is in the
# parity table. jq also accepts inputs no serializer writes (`nan`, `NaN`, `Infinity`;
# on 1.6 a leading `+`), where the server skips the line. Duplicate keys: jq,
# `JSON.parse` and Claude Code all keep the LAST.
def jsws: . == 9 or . == 10 or . == 11 or . == 12 or . == 13 or . == 32 or . == 160 or . == 5760
  or (. >= 8192 and . <= 8202) or . == 8232 or . == 8233 or . == 8239 or . == 8287 or . == 12288 or . == 65279;
def jstrim: explode as $c
  | [range(0; $c | length) | select($c[.] | jsws | not)] as $k
  | if $k == [] then "" else $c[$k[0]:$k[-1] + 1] | implode end;
def tagled: explode as $c
  | ($c | length) > 2 and $c[0] == 60 and $c[1] >= 97 and $c[1] <= 122
  and ([range(2; $c | length) | select($c[.] as $x
         | ($x >= 48 and $x <= 57) or ($x >= 65 and $x <= 90) or ($x >= 97 and $x <= 122) or $x == 95 or $x == 45 | not)] as $k
       | $k != [] and ($c[$k[0]] as $x | $x == 62 or ($x | jsws)));
def cmdname: split("<command-name>") as $s
  | [range(1; $s | length) | $s[.:] | join("<command-name>")
     | split("\r")[0] | split("\u2028")[0] | split("\u2029")[0] | select(contains("</command-name>"))] != [];
def prompttext:
  if contains("<pasted_content id=\"") then true
  else jstrim as $n
  | if $n == "" then false
    elif ($n | cmdname) then false
    elif ($n | split("<bash-input>") | length > 1 and (.[1:] | join("<bash-input>") | contains("</bash-input>"))) then true
    elif ($n | startswith("[Request interrupted by user")) and ($n | ltrimstr("[Request interrupted by user") | contains("]")) then false
    elif ($n | tagled) then false
    else true end
  end;
def prompt: .isMeta != true and .isCompactSummary != true and (.message | type) == "object"
  and (.message.content as $x
       | if ($x | type) == "string" then ($x | prompttext)
         elif ($x | type) == "array" then
           [$x[] | select(type == "object" and .type == "tool_result")] == []
           and [$x[] | select(type == "object" and .type == "text" and (.text | type) == "string") | select(.text | prompttext)] != []
         else false end);
def complete: ((has("isApiErrorMessage") | not) or .isApiErrorMessage == false)
  and (.message | type) == "object" and (.message.stop_reason | type) == "string";
def unsurrogate: reduce ("d", "D") as $d (.; reduce ("8", "9", "a", "b", "c", "d", "e", "f", "A", "B", "C", "D", "E", "F") as $h
  (.; split("\\u" + $d + $h) | join("\\uff")));
def tailrec($l; $u):
  ($l | contains("\"type\":\"continued-in\"")) as $m
  | ($l | (contains("\"type\":\"user\"") or contains("\"type\":\"assistant\""))) as $t
  | if ($m or $t) | not then "skip"
    else [$l | try fromjson catch ($l | unsurrogate | try fromjson catch empty)]
    | if . == [] or (.[0] | type) != "object" then "skip"
      else .[0]
      | if $m and .type == "continued-in" and (.continuedInSessionId | type) == "string" then
          .continuedInSessionId as $to
          | if ((has("sessionId") | not) or .sessionId == $u)
               and ($to | length) == 36
               and ([$to | explode[] | select((. == 45 or (. >= 48 and . <= 57) or (. >= 97 and . <= 102)) | not)] == [])
               and $to != $u
            then "+" + $to else "stop" end
        elif $t and .type == "assistant" then (if complete then "stop" else "skip" end)
        elif $t and .type == "user" then (if prompt then "stop" else "skip" end)
        else "skip" end
      end
    end;
def continued_in($u):
  [(split("\n") | reverse[]) as $l | tailrec($l; $u) | select(. != "skip")] | (.[0] // "stop")
  | select(startswith("+")) | .[1:];

# THE NEWEST REAL TURN'S EPOCH SECONDS (D-3102, D-3104; ARCH-65 moved it here
# from an inline python reader). The input is a slurped raw window; each line
# is parsed alone, so a window cut mid-record (`tail` can cut a first line)
# or a half-written last line skips that line and nothing else — the
# tolerance the python reader had (`json.loads` in a try). A lone surrogate
# escape, which jq refuses and `json.loads` accepts, is rewritten and parsed
# again, as the continuation reader does. A turn is a user or assistant row
# that is neither meta nor a compact summary and, for a user row with string
# content, does not start with one of the three command-chatter prefixes
# (`/compact` writes four rows; see `_transcript_last_turn_ts` in ccd/ccd). The
# stamp is cut to its first 19 characters before `strptime`, which sidesteps
# fractional seconds and the zone letter; a row whose stamp is missing, short
# or unparseable is skipped, so a malformed row can only make the answer older.
def chatter: type == "string"
  and (startswith("<local-command-caveat>") or startswith("<command-name>") or startswith("<local-command-stdout>"));
def turn_row: . as $l | try fromjson catch ($l | unsurrogate | try fromjson catch empty);
def turn_ts:
  [turn_row | select(type == "object")
   | select(.type == "user" or .type == "assistant")
   | select(.isCompactSummary != true and .isMeta != true)
   | select((.type == "user" and ((.message | type) == "object") and (.message.content | chatter)) | not)
   | .timestamp | select(type == "string" and length >= 19)
   | .[:19] | try (strptime("%Y-%m-%dT%H:%M:%S") | mktime) catch empty];
def last_turn_ts: split("\n") | map(turn_ts[]) | max // empty;
