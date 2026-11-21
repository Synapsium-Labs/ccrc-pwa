# ccd/lib/roster-card.jq — the coordinator roster card's ONE builder (durability D4, #757; its wake arm R-5a, D-8201).
#
# Loaded with `jq -L <dir>` and `include "roster-card";`, beside `transcript.jq`, by ccd/session-hook.sh, whose two
# callers both go through `_hook_roster_card`: the SessionStart arm (compact, resume, clear) and the wake arm (the
# first wake prompt after an idle compaction). Anything else on the box that ever needs the card (ccd finds this
# directory as `TRANSCRIPT_JQ_LIB`) loads this file too; a second spelling of the card anywhere is what
# `server/test/single-definition/roster-card.test.ts` refuses.
#
# Entry point: `roster_card($me; $now; $max)` over the body of `ccrc-api runs list` (`{runs: [...]}`): the session
# `$me`'s non-terminal runs, one line each, then an "awaiting you" line, all clipped to `$max` characters (surplus runs
# collapse into a "+N more" line); nothing at all when `$me` claims no open run. `$now` is epoch milliseconds.
# Every interpolated field goes through `s` (strings: a safe charset, 40 chars) or `n` (integers: a non-number reads
# 0), so no server byte injects prose. The text is pinned byte for byte by `server/test/session-hook-roster-card.test.ts`.
#
# Data for jq, never executed: installed 0644 at `~/.cc-sessions/lib/roster-card.jq` by deploy.sh's agent lane and by
# `ccrc install`. A missing file is a jq that fails to load, which the hook answers as "no card" (fail open).
#
# D-8126 (autonomy plan A9-1, spec §9.2): the card's second line is `roster_autonomy_line`, a LITERAL of this file, so no
# server byte reaches it: it re-states coordinator clause 21 to a context a compaction emptied. THE CAP IS STRUCTURAL: the
# header, that line, the collapse line at its longest and the awaiting-you line are reserved before any run line is
# admitted; the awaiting-you list collapses into "+N more" under what is left; and the joined card is clipped at `$max`
# last, so no reply, however long its fields or however many its runs, makes the card longer than `$max` or cuts the
# autonomy line (the header and the line together are about 330 characters).
def roster_autonomy_line: "ccrc-autonomy: before asking the operator, read your goals (`ccrc-api goals show <slug>`), decide, record (`ccrc-api calls record`), continue; stop only for an operator-only act or a physical block (coordinator clause 21).";
def roster_card($me; $now; $max):
  def s: tostring | gsub("[^A-Za-z0-9._:/-]"; "") | .[0:40]; def n: if type == "number" then floor else 0 end;
  def age($t): (($now - $t) / 1000 | floor) as $x | if $x < 3600 then "\(($x / 60 | floor))m" elif $x < 172800 then "\(($x / 3600 | floor))h" else "\(($x / 86400 | floor))d" end;
  [.runs[]? | select(.claimedBy == $me and (.state | IN("done", "failed") | not))] as $r |
  if ($r | length) == 0 then empty else [$r[] | "#\(.id | n) \(.program | s) w\(.wave | n)\(if .waveOf then "/\(.waveOf | n)" else "" end) \(.state | s) worker=\(.sessionId // "none" | s) \(age(.dispatchedAt // .openedAt)) unread=\(.unreadMail | n)"] as $l |
    ([$r[] | select(.state == "awaiting-review") | "review #\(.id | n)"] + [$r[] | select((.health.mailParked | n) > 0) | "parked mail #\(.id | n) (\(.health.mailParked | n))"]) as $w |
    "ccrc-roster: \($r | length) open run(s) you claim; re-read with `~/.local/bin/ccrc-api runs list`." as $h |
    roster_autonomy_line as $a |
    "+\($l | length) more open runs: ccrc-api runs list" as $m |
    ($max - ([$h, $a, $m] | join("\n") | length) - 1) as $fb |
    (reduce $w[] as $x ({o: [], n: 0}; if ("awaiting you: " + (.o + [$x, "+\($w | length) more"] | join("; ")) | length) <= $fb then .o += [$x] else .n += 1 end)) as $q |
    ("awaiting you: " + (if ($w | length) > 0 then ($q.o + (if $q.n > 0 then ["+\($q.n) more"] else [] end) | join("; ")) else "nothing" end)) as $f |
    (reduce $l[] as $x ({o: [], n: 0}; if ([$h, $a] + .o + [$x, $m, $f] | join("\n") | length) <= $max then .o += [$x] else .n += 1 end)) as $k |
    ([$h, $a] + $k.o + (if $k.n > 0 then ["+\($k.n) more open runs: ccrc-api runs list"] else [] end) + [$f]) | join("\n") | .[0:$max] end;
