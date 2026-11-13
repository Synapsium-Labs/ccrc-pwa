# ccd/lib/transcript.jq — the one transcript reader on the ccd side (ARCH-65).
#
# Loaded with `jq -L <dir>` and `include "transcript";` by ccd/ccd and by
# ccd/ccrc-doctor-checks. Entry points: `continued_in($u)` (the successor a
# slurped raw tail window names, or nothing), `last_turn_ts` (the newest real
# turn's epoch seconds in a slurped raw window, or nothing) and
# `limit_banner($mode; $since)` (whether the newest real row is a limit or auth
# banner, as `_transcript_limit_banner` answers it), `agent_end` (how a background agent's transcript tail ends: `finished`,
# `open`, `rate-limit [<resetsAt>]` or `none`, for the restart manifest's program, D-8368); and, for ccd/session-hook.sh's
# roster-card wake arm (R-5a, D-8201), `idle_compaction_open` (whether the newest
# compaction is an idle one with no turn since). Everything else is a
# helper. A named jq argument (`--arg u`) is not visible inside a module, so
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

# IS THE NEWEST REAL ROW A LIMIT BANNER (D-2362, D-2456, D-3522, D-3526; #2367
# moved it here from an inline python reader). `_transcript_limit_banner` in
# ccd/ccd holds the rule in words and the rc contract; this is the reading.
# The input is a slurped raw window plus the one newline bash's `printf '%s\n'`
# ends it with, so the last field `split` makes is that newline's and is
# dropped. Unlike `last_turn_ts`, a line that does not parse, or parses to
# anything but an object, CLEARS the candidate — fail closed, the python
# reader's tolerance: a blank line, a cut line, a BOM before the row
# (`json.loads` refuses one, and jq would read past it). A lone surrogate
# escape is rewritten and parsed again, as everywhere in this module.
#
# The answer is ONE string, printed with `-j`: "1", or "0" or "3", a newline,
# and what the bash function prints. A since is digits or it is none, and with
# none no row is dated at all (`lb_at`), so dated mode prints `-`.
#
# THE TIMESTAMP, AS PYTHON 3.12's `fromisoformat` READ IT, where Claude Code
# writes it: `YYYY-MM-DD`, any one separator, `HH:MM:SS`, an optional `.` or
# `,` fraction (dropped: the since is whole seconds, so the floor compares the
# same), then nothing, `Z`, or an offset `±HH`, `±HHMM`, `±HH:MM`, after at most
# one space. A date that does not round-trip (February 30th, second 60) is
# unreadable, as Python refuses it. Shapes python read and this does not — a
# date alone, no seconds, the basic format, an offset with seconds — are
# unreadable here: that never counts a 401 and never dates a banner, the side
# the rule already takes on an unreadable stamp. A stamp with no zone is UTC
# here, where python read it in the box's local zone.
#
# `resetsAt` prints when it is a finite whole number. Python printed only a
# JSON integer, so a whole number spelled as a float (`1.0`, `1e3`) prints
# here and printed nothing there; JSON.stringify spells neither. NULs are
# dropped from `rateLimitType`: bash's `$(…)` drops them anyway.
def lb_digits: length > 0 and ([explode[] | select(. < 48 or . > 57)] == []);
def lb_nodigits: explode as $c
  | ([range(0; $c | length) | select($c[.] < 48 or $c[.] > 57)] | .[0] // ($c | length)) as $k
  | $c[$k:] | implode;
def lb_offset: if . == "" or . == "Z" then 0
  elif (startswith("+") or startswith("-")) | not then empty
  else (if startswith("-") then -1 else 1 end) as $sign | .[1:] | split(":") as $p
    | (if ($p | length) == 2 and ($p[0] | length) == 2 and ($p[1] | length) == 2 then $p
       elif ($p | length) == 1 and ((.  | length) == 2 or (. | length) == 4) then [.[:2], .[2:]]
       else empty end)
    | select((.[0] | lb_digits) and (.[1] == "" or (.[1] | lb_digits)))
    | [(.[0] | tonumber), (if .[1] == "" then 0 else .[1] | tonumber end)]
    | select(.[0] <= 23 and .[1] <= 59)
    | $sign * (.[0] * 3600 + .[1] * 60)
  end;
def lb_epoch: select(type == "string" and length >= 19)
  | (.[:10] + "T" + .[11:19]) as $h
  | .[19:] | (if startswith(".") or startswith(",") then .[1:] | lb_nodigits else . end)
  | (if startswith(" ") and length > 1 then .[1:] else . end) | lb_offset as $off
  | [$h | try (strptime("%Y-%m-%dT%H:%M:%S") | mktime) catch empty][]
  | select((. | todate) == $h + "Z")
  | . - $off;
def lb_row: . as $l
  | if startswith("﻿") then empty
    else [try fromjson catch ($l | unsurrogate | try fromjson catch empty)][] end
  | select(type == "object");
def lb_at($s): if $s == null then null else [.timestamp | lb_epoch] | .[0] end;
# THE RATE-LIMIT ROW AND ITS RESET, ONE SPELLING FOR TWO READERS (D-8371): `limit_banner` and `agent_end` both test a row with
# `lb_ratelimit` and read its reset with `lb_reset`, so the two cannot disagree on one. `lb_reset` prints a finite whole number
# as digits, else the empty string.
def lb_ratelimit: .type == "assistant" and .isApiErrorMessage == true and .error == "rate_limit";
def lb_reset: (.quotaLimits | if type == "object" then . else {} end).resetsAt
  | if type == "number" and (isinfinite | not) and . == floor then . + 0 | tostring else "" end;
def limit_banner($mode; $since):
  ($mode == "stuck" or $mode == "dated") as $stuck
  | (if $since | lb_digits then $since | tonumber else null end) as $s
  | reduce (split("\n") | .[:-1][]) as $l (null; . as $f
      | [$l | lb_row] as $r
      | if $r == [] then null
        else $r[0] as $row | ($row | lb_at($s)) as $at
        | if ($row.type == "user" or $row.type == "assistant") | not then $f
          elif ($row | lb_ratelimit) then $row
          elif $stuck and $row.type == "assistant" and $row.isApiErrorMessage == true
            and $row.error == "authentication_failed" and $row.apiErrorStatus == 401
            and $s != null and $at != null and $at >= $s then $row
          elif $row.type == "user" and ($row.message | type) == "object" and ($row.message.content | chatter) then $f
          else null end
        end)
  | if . == null then "1"
    else . as $f | ($f | lb_at($s)) as $at
    | if $stuck and $f.error != "authentication_failed" and $s != null and $at != null and $at < $s then "3\n\($at)"
      elif $f.error == "authentication_failed" then "0\n\t\tauthentication_failed"
      else ($f.quotaLimits | if type == "object" then . else {} end) as $q
      | ($f | lb_reset) as $reset
      | ($q.rateLimitType | if type == "string" then [explode[] | select(. != 0)] | implode else "" end) as $kind
      | "0\n\($reset)\t\($kind)" + (if $mode == "dated" then "\t" + ($at | if . == null then "-" else tostring end) else "" end)
      end
    end;

# THE ROSTER CARD'S WAKE (R-5a, D-8201): is the newest compaction in a slurped raw tail window an IDLE one with no
# turn since? `true` or `false`. The box's spelling of `isIdleCompaction(t) && !t.turnAfter` over `readCompactionTail`
# (`server/src/idlenudge.ts`, D-5373), the reading the server's idle-compaction nudge makes; the session hook's wake arm
# reads it on the server's two wake prompts. Another process on another host, so two spellings, held equal by
# `server/test/session-hook-roster-card.test.ts` over one table. Rows are read oldest first and sidechain rows are
# skipped. A boundary (`system`/`compact_boundary`) with a uuid or a timestamp opens a compaction; one with neither
# closes any. Idle: Claude Code's notice after it (an `informational` row whose trimmed text begins with one of
# `idle_notice_prefixes`, `IDLE_COMPACT_NOTICE_PREFIXES` in shared/api.ts), or an `auto` trigger whose turn had
# finished before it (an `end_turn` assistant row, then a `stop_hook_summary` or `turn_duration` row, with no prompt
# after). A turn since: an assistant row, or a user row of tool results only, after it. A user prompt after it does NOT
# count: the wake prompt itself may already be in the file when the hook reads it. jq 1.6 rule above: no `first` or
# `any` around a `try`; each parse's `try` sits inside its own array constructor.
def idle_notice_prefixes: ["Compacted while idle"];
def idle_compaction_open:
  [split("\n")[] | select(length > 0) | [turn_row] | .[] | select(type == "object" and .isSidechain != true)]
  | reduce .[] as $r ({cur: null, e: false, s: false};
      ($r.type) as $t
      | ($r.message | if type == "object" then . else {} end) as $m
      | if $t == "system" and $r.subtype == "compact_boundary" then
          (($r.uuid | select(type == "string" and . != "")) // ($r.timestamp | select(type == "string")) // null) as $k
          | if $k == null then .cur = null
            else .cur = {trigger: ($r.compactMetadata | if type == "object" then .trigger else null end), notice: false,
                         fin: (.e and .s), after: false} | .e = false | .s = false end
        elif $t == "system" then
          (if .cur != null and $r.subtype == "informational" and ($r.content | type) == "string"
              and (($r.content | jstrim) as $x | [idle_notice_prefixes[] | select(. as $p | $x | startswith($p))] | length > 0)
           then .cur.notice = true else . end)
          | (if ($r.subtype | type) == "string" and ($r.subtype == "stop_hook_summary" or $r.subtype == "turn_duration") and .e
             then .s = true else . end)
        elif $t == "assistant" then
          .e = ($m.stop_reason == "end_turn") | .s = false | (if .cur != null then .cur.after = true else . end)
        elif $t == "user" then
          if $r.isCompactSummary == true or $r.isMeta == true then .
          else (if .cur != null and ($m.content | type) == "array" and ($m.content | length) > 0
                   and ([$m.content[] | select(type == "object" and .type == "tool_result")] | length) == ($m.content | length)
                then .cur.after = true else . end)
               | .e = false | .s = false end
        elif $t == "attachment" and ($r.attachment | type) == "object" and $r.attachment.type == "queued_command" then
          .e = false | .s = false
        else . end)
  | .cur
  | if . == null then false else (.notice or (.trigger == "auto" and .fin)) and (.after | not) end;

# HOW A BACKGROUND AGENT'S TRANSCRIPT ENDS (D-8368; the restart manifest's program, `ccd/lib/inflight-manifest.py`, hands it one
# raw tail window per agent). The input is a window of whole lines as a string: the program has already cut a partial first line
# when it read from mid-file. The answer is one word: `finished` (the newest real row is an assistant row that is not an API
# error and whose `stop_reason` is `end_turn`), `rate-limit` or `rate-limit <resetsAt>` (a `lb_ratelimit` row, with `lb_reset`'s
# integer when it has one), `open` (any other newest user or assistant row: a `tool_use` with no result after it, a tool result,
# an API error that is not a rate limit, another `stop_reason`) or `none` (no user or assistant row). NOT `complete`, which
# accepts `tool_use`. Non-user, non-assistant rows and chatter user rows are stepped over. A line that does not parse sets the
# candidate to `open`, FAIL CLOSED as `limit_banner` clears on one, and a later whole row replaces it: a torn final line (a field
# with no terminating newline that is not an object) is evidence the agent was still writing. The newest row left is a `reduce`
# over the lines, never `first` (the jq 1.6 rule above); each parse's `try` sits inside its own array constructor (`lb_row`).
def agent_end:
  split("\n") as $f
  | (if ($f | length) > 0 and $f[-1] == "" then $f[:-1] else $f end) as $ls
  | reduce $ls[] as $l (null; . as $c
      | [$l | lb_row] as $r
      | if $r == [] then "open"
        else $r[0] as $row
        | if ($row.type == "user" or $row.type == "assistant") | not then $c
          elif ($row | lb_ratelimit) then ($row | lb_reset) as $x | if $x == "" then "rate-limit" else "rate-limit " + $x end
          elif $row.type == "user" and ($row.message | type) == "object" and ($row.message.content | chatter) then $c
          elif $row.type == "assistant" and $row.isApiErrorMessage != true and ($row.message | type) == "object"
            and $row.message.stop_reason == "end_turn" then "finished"
          else "open" end
        end)
  | . // "none";
