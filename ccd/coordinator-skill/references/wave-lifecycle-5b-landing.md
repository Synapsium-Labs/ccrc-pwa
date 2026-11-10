# The wave lifecycle: step 5b, the landing route

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

### 5b — The landing route, from the repository's own rules

Before every landing, on every project, this session reads the PR's repository
and lands only by the route its rules give (spec 2026-09-23 §5.7). The reads
run fresh each time, never from memory, because the operator can change any of
them between two PRs. They are the block below, the **landing verdict**: run it
from your own session, in a checkout of the PR's repository, with `<pr>` and
`<handoffCommit>` filled in. It makes GETs only, prints exactly one line, and
never merges, enqueues or writes a setting.

```bash
( # The landing verdict (spec 2026-09-23 §5.7). GETs only: it never merges, enqueues or writes a setting.
PR=<pr> HC=<handoffCommit>
BOUND_S=${BOUND_S:-0} POLL_S=${POLL_S:-30} route=
set -o pipefail
say() { printf '%s\n' "$1"; exit 0; }
stop() { say "STOP $1"; }

# Read 1: the base, the head, the state and the review decision, from the PR itself. The answer is first required to be
# exactly one JSON value, and an object (none, several or malformed stop here): jq's exit status follows only the last of
# several values, and an earlier value it cannot index only prints an error, so the checks below would pass a usable last
# value whatever came before it. Then the base, the state and the head are judged on that JSON as GitHub sent it, before
# any extraction: `jq -r` prints a missing, null, numeric or boolean field as the text `null`, `123` or `true`, and a
# command substitution drops a trailing newline, so the text read out below may be something the answer never held. The
# base is a non-empty string of the characters a branch path is read with, the state is one of three words, and the head
# is a non-empty string with no newline. The base's anchors are `\A` and `\z`: jq's `$` also matches before a final newline.
r1=$(gh pr view "$PR" --json baseRefName,headRefOid,state,reviewDecision) || stop "unreadable: read 1"
jq -se 'length == 1 and (.[0] | type) == "object"' <<<"$r1" >/dev/null || stop "unreadable: read 1"
jq -e '(.baseRefName | type) == "string" and (.baseRefName | test("\\A[A-Za-z0-9._/-]+\\z"))' <<<"$r1" >/dev/null \
  || stop "unreadable: read 1 gave no usable base"
jq -e '.state | IN("OPEN", "CLOSED", "MERGED")' <<<"$r1" >/dev/null || stop "unreadable: read 1"
jq -e '(.headRefOid | type) == "string" and (.headRefOid | length) > 0 and (.headRefOid | contains("\n") | not)' <<<"$r1" >/dev/null \
  || stop "unreadable: read 1"
base=$(jq -r .baseRefName <<<"$r1") && head=$(jq -r .headRefOid <<<"$r1") && state=$(jq -r .state <<<"$r1") \
  || stop "unreadable: read 1"
[[ $base =~ ^[A-Za-z0-9._/-]+$ ]] || stop "unreadable: read 1 gave no usable base"
case "$state" in OPEN|CLOSED|MERGED) ;; *) stop "unreadable: read 1" ;; esac
[ "$state" = MERGED ] && say "MERGED head=$head"
[ "$state" = CLOSED ] && stop "not-at-head: the PR is CLOSED"
[ "$head" = "$HC" ] || stop "not-at-head: the PR head is $head"

# Read 1's reviews, in API order (oldest first), every page. A malformed page, an empty answer or a failed call is a
# stop, never "no requests". Every entry is validated whole, then only its id, state and user id are kept, so no
# login or free text reaches an argument. An entry with no user is a deleted account: its identity is its own review id.
rv=$(gh api --paginate "repos/{owner}/{repo}/pulls/$PR/reviews" | jq -sc '
  def sint: type == "number" and . == floor and . > 0 and . <= 9007199254740991;
  if length > 0 and all(.[]; type == "array")
     and all(.[][]; type == "object" and (.id | sint) and (.state | IN("APPROVED", "CHANGES_REQUESTED", "DISMISSED",
       "COMMENTED", "PENDING")) and (.user == null or (.user.id | sint)))
  then [.[][] | {id, state, user: (if .user == null then null else {id: .user.id} end)}]
  else error("malformed") end') || stop "unreadable: read 1's reviews"
# Per identity, the latest opinionated review (COMMENTED and PENDING neither clear nor replace one); the requests that
# stand are the review ids of the identities whose kept review requests changes. Only numbers reach the key.
sel=$(jq -nc --argjson rv "$rv" --argjson pr "$r1" '
  {summary: ($pr.reviewDecision == "CHANGES_REQUESTED"),
   reviews: ([reduce $rv[] as $e ({}; if $e.state | IN("APPROVED", "CHANGES_REQUESTED", "DISMISSED")
       then .[if $e.user == null then "r:\($e.id)" else "u:\($e.user.id)" end] = $e else . end)
     | .[] | select(.state == "CHANGES_REQUESTED") | .id] | unique)}') || stop "unreadable: read 1's reviews"
key=$(jq -c --arg pr "$PR" --arg head "$HC" '{pr: $pr, head: $head, summary, reviews}' <<<"$sel") \
  || stop "unreadable: read 1's reviews"
standing=$(jq -r '.summary or (.reviews | length > 0)' <<<"$sel") || stop "unreadable: read 1's reviews"
# A requested change stops every route. Only the operator's answer to that stop, ignore, skips it: CR_IGNORE holds
# the exact key printed here, set for this one invocation (a convention check, not authentication). It skips nothing
# else, and a summary-only request with no review id to name is never skipped.
if [ "$standing" = true ]; then
  [ -n "$CR_IGNORE" ] && [ "$CR_IGNORE" = "$key" ] && jq -e '.reviews | length > 0' <<<"$sel" >/dev/null \
    || stop "changes-requested: operator decision required; key=$key"
fi

# Read 2: every rule of every active ruleset on that base. A type this block does not know is a stop. The fields the
# approval check weighs are typed here, where they are read (a present count is a non-negative safe integer; a missing
# one keeps its default), and every required-check entry must be a named object. A present thread resolution is still
# typed as a boolean, though nothing reads it now: a malformed answer stays a stop.
rules=$(gh api --paginate "repos/{owner}/{repo}/rules/branches/$base" | jq -sc '
  def cnt: type == "number" and . == floor and . >= 0 and . <= 9007199254740991;
  def typed($k; f): (has($k) | not) or (.[$k] | f);
  if length > 0 and all(.[]; type == "array")
     and all(.[][]; type == "object" and (.type | type) == "string"
       and (if .type | IN("pull_request", "merge_queue", "required_status_checks") then (.parameters | type) == "object" else true end)
       and (if .type == "pull_request" then (.parameters | typed("required_approving_review_count"; cnt)
         and typed("required_review_thread_resolution"; type == "boolean")) else true end)
       and (if .type == "required_status_checks" then (.parameters.required_status_checks | type) == "array"
         and all(.parameters.required_status_checks[]; type == "object" and (.context | type) == "string" and (.context | length) > 0)
         else true end))
  then flatten(1) else error("malformed") end') || stop "unreadable: read 2"
# The stop lines print a list of values joined by commas, an empty string as "" and any other value as it is. That text
# only shows what was found: whether a queue rule or an unknown type exists, and how many methods there are, is decided
# on the arrays, so a value that prints as nothing is still a value.
shown='map(if . == "" then "\"\"" else . end) | join(",")'
unk=$(jq -c '[.[].type] - ["pull_request", "merge_queue", "required_status_checks", "required_linear_history",
  "workflows", "code_scanning", "required_deployments", "required_signatures", "non_fast_forward", "deletion",
  "creation"] | unique' <<<"$rules") || stop "unreadable: read 2"
[ "$unk" = "[]" ] || stop "unknown-rule-type: $(jq -r "$shown" <<<"$unk")"

# Read 3: classic protection. A 404 is "not protected" only with exactly that message; a 401 or 403 goes to read 3b.
# A 200 body is typed where the approval check and the required set read it (the review count, the names of the
# required checks; the conversation switch's `enabled`, which nothing reads now, stays typed): a missing field keeps
# its default, a wrong type is a stop, and the body is exactly one value (`-s` slurps the answer: an empty body, or
# two or more values, is a stop here). The names are one predicate, `classic_names`, which read 3b's projection of the
# same checks uses too: a missing or null container or list is no entries, a present one is an object or an array, and
# every entry has a non-empty string name.
# The call's exit status is kept apart from the text it printed (`rc3`, read on the line after the call): text that says
# 200 is an answer only when the call exited 0, while a 404 and a 401 or 403 come, by design, from a call that exits
# nonzero, so the status is not checked ahead of the status line. The 404's message is judged in jq on the JSON itself,
# one value and exactly those words: `jq -r` and a command substitution would drop a trailing newline from it.
names='def named: type == "string" and length > 0;
  def typed($k; f): (has($k) | not) or (.[$k] | f);
  def classic_names: . == null or (type == "object"
    and typed("checks"; . == null or (type == "array" and all(.[]; type == "object" and (.context | named))))
    and typed("contexts"; . == null or (type == "array" and all(.[]; named))));'
r3=$(gh api -i "repos/{owner}/{repo}/branches/$base/protection" 2>/dev/null)
rc3=$?
c3=$(head -n1 <<<"$r3" | cut -d' ' -f2) b3=$(tr -d '\r' <<<"$r3" | sed '1,/^$/d') via=3
case "$c3" in
  200) [ "$rc3" = 0 ] || stop "unreadable: read 3"
       prot=$(jq -sce "$names"'
         def cnt: type == "number" and . == floor and . >= 0 and . <= 9007199254740991;
         if length == 1 then .[0] else error("not exactly one value") end
         | if type == "object"
            and (.required_pull_request_reviews | . == null or (type == "object" and typed("required_approving_review_count"; cnt)))
            and (.required_conversation_resolution | . == null or (type == "object" and typed("enabled"; type == "boolean")))
            and (.required_status_checks | classic_names)
         then . else error("not a usable object") end' <<<"$b3") || stop "unreadable: read 3" ;;
  404) jq -se 'length == 1 and .[0].message == "Branch not protected"' <<<"$b3" >/dev/null \
         || stop "unreadable: read 3 answered 404"
       prot='{}' ;;
  401|403) via=3b
       prot=$(gh api "repos/{owner}/{repo}/branches/$base" | jq -sc "$names"'
         if length == 1 then .[0] else error("not exactly one value") end
         | .protection | if .enabled == true
         then (if .required_status_checks | classic_names then {required_status_checks} else error("unnamed") end)
         elif .enabled == false then {} else error("no enabled") end') \
         || stop "unreadable: read 3b, after read 3 answered $c3" ;;
  *) stop "unreadable: read 3 answered ${c3:-nothing}" ;;
esac

# Read 4: the merge settings. A missing field is unreadable, never false.
r4=$(gh api "repos/{owner}/{repo}" | jq -ce '{allow_squash_merge, allow_merge_commit, allow_rebase_merge,
  allow_auto_merge} as $s | if all($s[]; type == "boolean") then $s else error("missing") end') \
  || stop "unreadable: read 4"

# The method set (§5.7.2): the settings, intersected with EVERY pull_request rule, minus merge under linear history.
methods=$(jq -nc --argjson s "$r4" --argjson r "$rules" --argjson p "$prot" '
  [if $s.allow_squash_merge then "squash" else empty end, if $s.allow_merge_commit then "merge" else empty end,
   if $s.allow_rebase_merge then "rebase" else empty end]
  | reduce ($r[] | select(.type == "pull_request")
      | .parameters.allowed_merge_methods // ["merge", "squash", "rebase"] | map(ascii_downcase)) as $a
      (.; map(select(IN($a[]))))
  | if any($r[]; .type == "required_linear_history") or $p.required_linear_history.enabled == true
    then map(select(. != "merge")) else . end') || stop "unreadable: the method set"
qs=$(jq -c '[.[] | select(.type == "merge_queue") | (.parameters.merge_method // "unknown") | ascii_downcase] | unique' \
  <<<"$rules") || stop "unreadable: read 2"
if [ "$qs" != "[]" ]; then
  route=Q qshow=$(jq -r "$shown" <<<"$qs") || stop "unreadable: read 2"
  jq -e 'length == 1' <<<"$qs" >/dev/null || stop "two-queue-methods: $qshow"
  method=$(jq -r '.[0]' <<<"$qs") || stop "unreadable: read 2"
  jq -e --argjson q "$qs" 'any(.[]; . == $q[0])' <<<"$methods" >/dev/null \
    || stop "queue-method-not-allowed: the queue merges by $qshow and the method set is $methods"
  [ "$(jq -r .allow_auto_merge <<<"$r4")" = true ] || stop "auto-merge-off: a merge_queue rule applies"
else
  method=$(jq -r 'if any(.[]; . == "squash") then "squash" elif any(.[]; . == "merge") then "merge"
    elif length > 0 then "rebase" else "" end' <<<"$methods") || stop "unreadable: the method set"
  [ -n "$method" ] || stop "method-set-empty: the settings, the pull_request rules and linear history leave none"
  [ "$method" = rebase ] && stop "rebase-only: rebase is the only method left"
fi

# Read 3b knows no linear history and no strictness: the merge method is a stop, and on a direct route so is a head
# behind the base. Route Q needs no strictness (the queue tests the merged group itself), so it reads no compare.
if [ "$via" = 3b ]; then
  [ "$method" = merge ] && stop "read-3b-unknowable: read 3 answered $c3 and the method is merge"
  if [ "$route" != Q ]; then
    behind=$(gh api "repos/{owner}/{repo}/compare/$base...$HC" | jq -e .behind_by) \
      || stop "unreadable: the compare read under read 3b"
    [ "$behind" = 0 ] || stop "read-3b-unknowable: read 3 answered $c3 and the head is $behind behind the base"
  fi
fi

# The required set (§5.7.3): every ruleset's required checks, plus classic checks and legacy contexts. A name an App
# is pinned for keeps its App; the same name unpinned is the same requirement. Then strictness and the other gates.
req=$(jq -nc --argjson r "$rules" --argjson p "$prot" '
  [($r[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]?
     | {context, app: .integration_id}),
   ($p.required_status_checks.checks[]? | {context, app: (if .app_id == -1 then null else .app_id end)}),
   ($p.required_status_checks.contexts[]? | {context: ., app: null})]
  | unique | . as $all
  | map(select(.app != null or (.context as $c | all($all[]; .context != $c or .app == null))))') \
  || stop "unreadable: the required set"
strict=$(jq -nr --argjson r "$rules" --argjson p "$prot" --arg via "$via" '
  if any($r[]; .type == "required_status_checks" and .parameters.strict_required_status_checks_policy == true)
     or $p.required_status_checks.strict == true then "yes" elif $via == "3b" then "unknown" else "no" end') \
  || stop "unreadable: strictness"
gates=$(jq -nr --argjson r "$rules" --argjson p "$prot" '
  [($r[] | select(.type | IN("workflows", "code_scanning", "required_deployments", "required_signatures")) | .type),
   (if $p.required_signatures.enabled == true then "classic required_signatures" else empty end)]
  | unique | join(",")') || stop "unreadable: the other gates"

# Read 5, judged name by name: the head's check runs and its statuses ARRAY, never the combined state.
checks() {
  local cr st
  cr=$(gh api --paginate "repos/{owner}/{repo}/commits/$HC/check-runs" \
    | jq -sc 'if length > 0 and all(.[]; type == "object" and (.check_runs | type) == "array") and all(.[].check_runs[]; type == "object")
      then [.[].check_runs[] | {name, status, conclusion, app: (.app | {id, slug})}] else error("malformed") end') \
    || { echo unreadable; return; }
  st=$(gh api --paginate "repos/{owner}/{repo}/commits/$HC/status" \
    | jq -sc 'if length > 0 and all(.[]; type == "object" and (.statuses | type) == "array") and all(.[].statuses[]; type == "object")
      then [.[].statuses[] | {context, state}] else error("malformed") end') \
    || { echo unreadable; return; }
  jq -nr --argjson q "$req" --argjson cr "$cr" --argjson st "$st" '
    def runs($x): [$cr[] | select(.name == $x.context and ($x.app == null or .app.id == $x.app))];
    def sts($x): if $x.app == null then [$st[] | select(.context == $x.context)] else [] end;
    def judge($x): runs($x) as $r | sts($x) as $s
      | if $x.app != null and ($r | length) == 0 and any($st[]; .context == $x.context) then "unverifiable"
        elif any($r[]; .status == "completed" and (.conclusion | IN("success", "neutral", "skipped") | not))
          or any($s[]; .state | IN("failure", "error")) then "red"
        elif any($r[]; .status != "completed") or any($s[]; .state == "pending") then "pending"
        elif ($r | length) > 0 or any($s[]; .state == "success") then "passing"
        else "not-reported" end;
    def kind($x): if any(runs($x)[]; .app.slug == "github-actions") then "github-actions"
      elif (runs($x) | length) > 0 then "app \(runs($x)[0].app.id)" else "status" end;
    [$q[] | {x: ., s: judge(.)}] as $j
    | first(("unverifiable", "red", "pending", "not-reported") as $w | select(any($j[]; .s == $w))
        | "\($w) " + ([$j[] | select(.s == $w) | .x.context + (if $w == "red" then " [\(kind(.x))]" else "" end)]
        | join(", "))) // "passing"' || echo unreadable
}
v=$(checks) w=${v%% *}
# A bounded wait re-reads read 5 only: the reviews, the rules and the head stay this run's snapshot (section 5b).
# Each sleep is cut to the time left of BOUND_S seconds and none starts once it is spent; the read after the last sleep decides.
if [ "$w" = not-reported ] && [ "$BOUND_S" -gt 0 ]; then
  end=$((SECONDS + BOUND_S))
  while [ "$w" = not-reported ]; do
    left=$((end - SECONDS))
    [ "$left" -gt 0 ] || break
    [ "$left" -lt "$POLL_S" ] || left=$POLL_S
    sleep "$left"; v=$(checks) w=${v%% *}
  done
fi
case "$w" in
  passing) ;;
  unverifiable) stop "unverifiable: ${v#* } shows only as a commit status" ;;
  red) say "RED ${v#* }" ;;
  pending) say "WAIT pending: ${v#* }" ;;
  not-reported) [ "$BOUND_S" -gt 0 ] && stop "not-reported: ${v#* } within ${BOUND_S}s"
                say "WAIT not-reported: ${v#* }" ;;
  *) stop "unreadable: read 5" ;;
esac

# The route (§5.7.4). No route uses --admin: a coordinator never passes --admin to the merge command and never makes
# a GitHub API merge or enqueue call itself (spec §11, the amendment of 2026-10-25, ruling 5, which supersedes the
# approval licence). On 2026-11-09 the operator answered for the policy authority (D-8124): one admin-merge door,
# `ccd pr-admin-merge`, may land a PR whose only stop is this one, and it is not a route, so the ROUTE lines keep
# admin=never. So a direct route that needs an approval the fleet cannot give, and finds it missing, stops here,
# whether or not a request stands: a route's merge could only be refused, or pass over the approval by a bypass. A
# required approval is missing unless read 1's reviewDecision is exactly APPROVED: any other value, empty or absent,
# is missing.
if [ "$route" != Q ]; then
  if [ "$req" != "[]" ] || [ -n "$gates" ]; then route=G; else route=U; fi
fi
missing=$(jq -nr --argjson r "$rules" --argjson p "$prot" --argjson pr "$r1" '
  if (any($r[]; .type == "pull_request" and (.parameters.required_approving_review_count // 0) > 0)
      or ($p.required_pull_request_reviews.required_approving_review_count // 0) > 0) | not then "no"
  elif $pr.reviewDecision == "APPROVED" then "no"
  else "yes" end') || stop "unreadable: the approval"
if [ "$route" != Q ] && [ "$missing" = yes ]; then
  stop "approval-missing: route $route needs an approval the fleet cannot give; only the admin-merge door may land it (D-8124)"
fi
say "ROUTE $route method=$method admin=never strict=$strict"
)
```

Run it once the review is clean and the run is at `merging` (§4), in the
order step 3 gives for route Q, and again after every wait. Its first word
decides what this session does, and nothing else does:

- `ROUTE Q method=<m> admin=never` — the native queue, merging by `<m>`: land
  as "Landing on a native-queue project" (step 3) says, with no method flag
  and never `--admin`, the read-back and the disarm rule included, and the
  checks gate with its four exits, which a `ROUTE Q` answer does not waive.
- `ROUTE G method=<m> admin=never` — a gated direct merge: every required check
  has passed on the head. Merge from your own session with exactly
  `gh pr merge <pr> --<method> --match-head-commit <handoffCommit>`, `<method>`
  being the line's `<m>`; on a merge-commits-only repository that is exactly
  `gh pr merge <pr> --merge --match-head-commit <handoffCommit>`.
- `ROUTE U method=<m> admin=never` — an ungated direct merge: nothing is
  required and nothing waits. The same spelling as route G.
- `admin=never` — no `--admin`, on every route (**No `--admin`**, below).
- `strict=yes` — a strict-protection repository: clause 15's land-sync applies
  as it does today. `strict=no` — it does not. `strict=unknown` comes only under
  read 3b: on a direct route the verdict has already stopped on a head behind
  the base, and route Q needs no strictness, since the queue tests the merged
  group itself.
- `MERGED head=<sha>` — the PR already landed: prove it as step 3 does
  (MERGED, `headRefOid` equal to `handoffCommit`). It is not a stop; a
  different head fails the proof, and that is reported, never closed on. A PR a
  merge train landed reads CLOSED instead, so for it the verdict prints
  `STOP not-at-head: the PR is CLOSED`. Before you report that stop, prove the
  landing as step 3 does: CLOSED, `headRefOid` equal to `handoffCommit`, and
  `landedInTrain: true` on the PR's row of `ccd pr-state --session
  <sessionId>`. Where that proof holds, the PR landed, as on this line. Where it
  does not, the stop stands: `trainUnproven`, no row or another head is reported
  as that stop at once, while `trainUnread` means ccd could not read the train
  record (no time left in its budget, a timeout, GitHub unreachable), so read
  the row once more and report the stop if it still reads `trainUnread`.
- `WAIT pending: <names>` — a reported required check is still running. Wait
  in the foreground, `gh pr checks <pr> --required --watch`, again if the call
  times out while a reported required check is still pending, then run the
  verdict again — never by ending your turn: no mail comes when checks finish.
  Once this landing attempt's bounded wait is spent, which a `BOUND_S=300` run
  that ends on this very line spends too (**After a bounded wait**, below), do
  not wait: report the line to the operator and leave the landing stopped.
- `WAIT not-reported: <names>` — a required name nothing has reported on the
  head yet, whatever `gh pr checks <pr> --required` exits: it judges only the
  checks that have reported, and its `--watch` returns at once when every
  reported one is green. Wait on every check instead,
  `gh pr checks <pr> --watch --interval 30`, once, as one Bash call with its
  timeout at 600000, never repeated, whatever it exits or however it ends: a
  check that is not required and never completes must not hold the wait open.
  Then run the verdict again with `BOUND_S=300` on the line before it, and the
  Bash tool's timeout at 600000. It reads read 5 again every 30 seconds, each
  sleep cut short to what is left of its 300 seconds.
  **The bound is five minutes after the last of the PR's reported checks finished.**
  If the watch was cut off at its timeout, the five minutes start there instead:
  fifteen minutes of waiting budget in all, plus the time the commands
  themselves take, which this shell does not bound: only each Bash call's
  timeout at 600000 does. The read after the last sleep, made once the budget
  is spent and so outside it, decides the wait.
  A name it still reads as not reported is the stop `not-reported`. A `ROUTE`
  it prints is not yet landing permission: see **After a bounded wait**, below.
  Once this landing attempt's bounded wait is spent, none of this is started
  again: report the line to the operator and leave the landing stopped.
- `RED <names>` — a required check is red on the head, each name with its
  kind. If it is the PR's own, that is the existing fix-round rule (step 3:
  on route Q disarm first, then a fix round to the owning worker on the
  `merging → working` edge), in SKILL.md step 6's `red: #<pr>` form. If it
  is not the PR's own and its kind is
  `[github-actions]`, one `gh run rerun <run id> --failed` and the same wait,
  then the verdict again. One of kind `[app <id>]` or `[status]` that is not
  the PR's own, which no rerun here reaches, or one still red after the one
  rerun, is the stop `red-unreachable`. Once this landing attempt's bounded wait
  is spent (**After a bounded wait**, below), that one rerun buys no waiting:
  run the verdict after it with `BOUND_S=0`, and if that line is a `WAIT`,
  report it and stop, with no watch.
- `STOP <reason>: <what it read>` — a stop (below).
- Anything else — no line at all (the run was cut off or did not parse), more
  than one line, or a first word this list does not name — is the stop
  `verdict-unread`: say what the run printed, and never land, enqueue or choose
  a route by hand.

**After a bounded wait.** While the verdict waits inside `BOUND_S`, it reads
read 5 again and nothing else: the PR's reviews, the rules and the head are the
snapshot from the start of that run, and nothing here claims they are watched
while it waits. So a `ROUTE` printed by a run with `BOUND_S` above 0 is not
landing permission. Discard it, and before you enqueue or merge anything run the
complete verdict afresh with `BOUND_S=0`, `CR_IGNORE` set as **A requested
change** says when the operator answered ignore, so that every read is made
again. A verdict run without `BOUND_S`, after an external `--watch` wait, needs
no second run: every run of the block makes every read, and its line goes by its
bullet. On the fresh run after a bounded one, a `STOP` or `RED` goes by its
bullet. A fresh `WAIT`, `pending` or `not-reported`, a required name newly found
on that read included, is not permission either: report that line to the
operator and leave the landing stopped. Do not start a waiting phase again for
it: no second watch, no second `BOUND_S=300`, and not the first-use instructions
of the `WAIT` bullets above, whose budget is spent.

A landing attempt is one run of the landing procedure, entered through one of
two doors. The first is a fresh accepted entry to `merging` for the reviewed
handoff; after a fix round, that is only once its edits are complete, a new
independent review has passed on the changed tip, and the run has entered
`merging` again; re-reading a run that is still at `merging` is not an entry,
and states are never cycled to make one. The second is the re-enqueue step 3
gives for one genuinely dequeued queue entry, after the notice, the PR and the
queue are measured afresh and the queue's own `merge_group` reason is read, and
only where step 3 permits a re-enqueue rather than a fix round or a stop (a
dequeue asked for because a request for changes was observed is that stop, not
this door); it may be the same reviewed head, still at `merging`. A replayed or
duplicate notice, another measurement of the same dequeue, and a PR already
re-enqueued or merged are not another attempt. An attempt's enqueue is complete
when the read-back proves a real queue entry; auto-merge only armed is not one,
begins no attempt and goes by step 3's disarm rule; a direct merge still needs
its exact-head `MERGED` proof. A stop, a report, a spent `WAIT`, a fix round's
edits alone, a new commit, a fresh CI result and a fix-round mail each grant
nothing.

The budget is spent once this landing attempt has run its `BOUND_S=300` verdict,
also when that run ends early on a name that started running. It stays spent for
the rest of the attempt, whichever arm leads back to the verdict (the checks
gate's exit `1`, the one rerun a `RED` allows, the `CR_IGNORE` run). Every later
run of the verdict uses `BOUND_S=0`, and any later `WAIT`, pending or
not-reported, including the `WAIT pending` the bounded run itself prints, is
reported the same way and leaves the landing stopped: no watch, and no renewal
when another required name becomes missing or pending. The operator's ignore
answer permits only the complete fresh verdict with the exact `CR_IGNORE` key,
inside the current attempt: it neither replenishes nor consumes a waiting phase,
and when the bound is spent that run uses `BOUND_S=0`, a `WAIT` it prints is
reported with no watch. A different required name, a returned route, a rerun,
the clock, an account or session resumption and a repeated mail are not resets.
Outside these two doors, only an explicit operator instruction to start another
attempt authorizes one: never infer it from an ignore answer or from automation,
and no report, rerun, fresh route or passage of time is one.

**No `--admin`.** A coordinator never passes `--admin` to gh and never makes a
GitHub API merge or enqueue call itself (spec §11, the amendment of 2026-10-25,
ruling 5, and its amendment of 2026-11-09, D-8124): no route passes `--admin`,
and the one admin merge there is, `ccd pr-admin-merge`, is a door that checks
for itself, never a route and never a fallback (**The admin-merge door
(D-8124)**, below). The ruling of 2026-10-25 supersedes the approval licence of
spec §5.7.4 and §11
item 10, so no answer read here licenses `--admin`: not a missing approval, not
`enforce_admins`, and not a ruleset's `current_user_can_bypass`, which the
verdict no longer reads. A direct route that needs an approval the fleet cannot
give, and finds it missing (a `pull_request` rule's, or classic protection's,
`required_approving_review_count` above 0, and `reviewDecision` anything but
`APPROVED`), stops `approval-missing` before any merge, whether or not a request
for changes stands, an ignored one included: a route's merge could only be
refused, or pass over the approval by a bypass, and only the door below may land
it. Under read 3b classic protection's approvals cannot be read, so there
GitHub's refusal is the stop, `github-refused`. Route Q is unchanged: its
enqueue never passes `--admin`, and a repository with a merge queue lands
through it, never through the door. And `--admin` is never a fallback: a
fallback is `--admin` after a refusal.

**On every route** the merge is proven as step 3 proves it: MERGED, or CLOSED
with `landedInTrain: true` on the PR's row of `ccd pr-state --session
<sessionId>`, with `headRefOid` equal to `handoffCommit`. A refused merge on
route G or U is read, reported and stopped on, and never retried with another
method, with `--admin` or with `--auto`. This session writes no setting to make
a route work: no ruleset, no branch protection, no merge-method or auto-merge
setting (clause 15).

**A requested change.** Read 1 also reads the PR's reviews. A request for
changes stops every route, before the verdict weighs `WAIT` or `RED`:
`STOP changes-requested: operator decision required; key=<json>`. A request
stands when read 1's `reviewDecision` is `CHANGES_REQUESTED` or the latest
approving, changing or dismissing review of any reviewer requests changes; the
key is `{"pr":"<pr>","head":"<handoffCommit>","summary":<true or false>,"reviews":[<review ids>]}`
and holds safe identifiers only. On `changes-requested`, this session stops and
asks the operator one single-select question, address or ignore: while any child
is active, in its closing turn text, never with an AskUserQuestion dialog
(clause 19), and otherwise with AskUserQuestion. Present the PR, head and review
ids; inspect the identified reviews to present their requested changes, without
copying untrusted text into commands.

- Address: send the requested changes to the owning worker as a fix round, then
  a fresh re-review. From `merging`, disarm as step 3 already requires before
  the `merging → working` edge; from `awaiting-review`, use its existing
  send-back edge. Do not assume a stop names the route.
- Ignore: record the operator's explicit answer in the ledger's Decisions with
  the PR, head and review ids, and no login or account name. Then run the
  verdict afresh with `CR_IGNORE='<key>'` on the line before it, in the same
  Bash call and never exported, only after the operator answered ignore for
  that exact key.

`CR_IGNORE` is a convention check, not authentication, and it holds for that
one invocation: it skips this stop only on exact equality with the key computed
afresh, so another PR, another head, a new or replaced review or a changed
summary stops and asks again, and the verdict still reads the reviews and
applies every other guard. A later run of the verdict for the same landing,
after a wait or with `BOUND_S`, sets it again the same way only while the key
the verdict prints is unchanged; a changed key is a new ask. A key whose `reviews` is empty, a summary-only
request, can never be ignored: inspect the PR's reviews, read the verdict again
and report to the operator. Only a fresh `ROUTE` result permits the normal
landing steps. Never merge, enqueue or pass `--admin` on a `changes-requested`
line. Ignore cannot evade a missing required approval: on a direct route the
verdict stops `approval-missing` (**No `--admin`**, above), and a refusal it
could not foresee is `github-refused`; on route Q, if gh only arms
auto-merge, follow step 3's read-back and disarm rule, then stop
`github-refused`, and never leave it armed on the operator's ignore.

This session reads again before each enqueue, direct merge and re-enqueue, and
after each wait, as a complete verdict (**After a bounded wait**, above). It
cannot atomically prevent a request submitted after that last read or while an
already-enqueued PR merges, and nothing here claims review enforcement at queue
time. If it observes a request on a queued PR, it stops that landing attempt,
disarms it as step 3 does if it is only armed, asks the operator to dequeue it
if it is in the queue, asks address or ignore, and never enqueues again
silently. Watching a queued PR continuously is a server follow-up, not this
skill's.

**The landing line.** Every run that enters `merging` pins an entry for its PR
on its project's landing line, and the entry's `pinnedSha` is the recorded head
(**The recorded head**, §5): the server pins it from the same re-measurement
that answers `verifiedHead`. Before each enqueue, direct merge and re-enqueue,
once the verdict, and on route Q the checks gate, have answered, read the line:
`GET /api/landing?project=<project>` (`ccrc-api landing show --project
<project>`). Land only when its `order` is not paused and this PR's entry for
this run reads `pinned` with a `pinnedSha` equal to the head you bind. A paused
line, an entry in another state, a `pinnedSha` that differs from that head or a
read that fails in any other way than a 404 (a timeout, a 401, a 5xx, a
transport error or an answer you cannot parse) lands nothing: report what it
read to the operator and leave the landing stopped, and never bind another head
to match it. A PR with no entry, which a run that entered `merging` before the
line existed leaves, lands as the verdict says, and your turn's text names the
missing entry. A read answered 404 comes from a server older than the line: read
it as no entry, and land the same way. The order it answers is read and not yet
acted on: which entry lands next is the line's head, a later stage's.

**The admin-merge door (D-8124).** On `STOP approval-missing`, and on no other
line, once the landing line (above) answers `pinned` at the head you bind, run
`ccd pr-admin-merge --repo <owner/repo> --pr <pr> --head <handoffCommit>` once,
from your own session, in the foreground. It checks for itself that the setting
is on, that you are a coordinator, that the fleet's GitHub identity is an admin
of the repository, that its base has no merge queue, that the PR is open, not a
draft and at that head, that it is a PR from a branch of the repository itself
and opened by the fleet's own GitHub identity (a fork PR or another account's PR
is refused, whatever its checks read), that no review requests changes, that every required
check passes on that head (a skipped or neutral one counts, as GitHub counts it),
that its base carries no rule the door cannot judge (it refuses any ruleset rule
type it does not read, such as required workflows, code scanning, deployments,
signed commits, a branch lock or update restriction, and commit or file
patterns, and classic signed commits, branch lock and conversation resolution) and, where strict
up-to-date applies, that the head is not behind the base, and that the repository
allows a merge commit or allows only a squash; it then merges with that method,
pinned to the head, and journals it. Its one line decides: `MERGED …` is proven
as every route is (MERGED at `handoffCommit`, step 3); `REFUSED <reason>: …`
leaves the stop standing, reported as `approval-missing` with the door's line;
`unproven` is reported, never retried. Never run it twice for one attempt, never
after `github-refused`, `changes-requested` or any other stop, and never in
place of route Q: a repository with a merge queue lands through it.

**A stop.** A stop enqueues nothing and merges nothing. It leaves the run where
it is (at `merging` or `awaiting-review`) and changes nothing, with one
exception, the new-head route below. Say in your turn's text which stop fired
and what it read, for the operator: every stop goes to the operator, and only
that exception goes on to the new-head route as well. The verdict stops with one
of these reasons: `unreadable`, `read-3b-unknowable`, `not-at-head`,
`unknown-rule-type`, `method-set-empty`, `rebase-only`,
`queue-method-not-allowed`, `two-queue-methods`, `auto-merge-off`,
`unverifiable`, `not-reported`, `changes-requested`, `approval-missing`. A
`changes-requested` stop is read before `WAIT` and `RED` on every route and is
the operator's to decide, as **A requested change** above says. An
`approval-missing` stop goes to the admin-merge door first, once (**The
admin-merge door (D-8124)**, above): a `MERGED` line leaves no stop, and a
`REFUSED` one is reported to the operator with the door's line. Four stops no
read decides are yours to name: `red-unreachable` (above), `verdict-unread`
(above), `checks-gate-unread` (step 3) and `github-refused`, a merge GitHub
refused for a rule it enforces at merge and this session does not verify —
reviews, signatures, deployments, code scanning, required workflows — which this
session never works around. Not a stop: a required check red on the head that is
the PR's own; that goes to the fix-round rule, on route G exactly as on route Q.
A `red-unreachable` whose red is `main`'s own and already fixed on `main` needs
a new head, and this session takes the new-head route itself (D-7588). It
disarms first on route Q, then sends a fix round to the owning worker on the
`merging → working` edge, in SKILL.md step 6's `ejected: new-head:#<pr>` form,
which records the base on the advance, for one clean merge of `main` and nothing
else, then dispatches a review run whose brief names that merge commit as the
change under review; the reviewer still reads the whole diff (reviewer clause
5). Show both facts with reads you can type, after one `git fetch origin`:
read that one required name on a `main` sha with `gh api --paginate
'repos/{owner}/{repo}/commits/<sha>/check-runs'` and `gh api --paginate
'repos/{owner}/{repo}/commits/<sha>/status'`, judged as read 5 judges it: red
when a completed run of it concluded other than success, neutral or skipped, or
a status of it reads failure or error; passing only when neither is red, none is
pending, and a run of it or a success status reports it. The red is `main`'s own
when that name reads red on a commit that `git rev-list --first-parent
--max-count=20 <handoffCommit>..origin/main` lists, read newest first and
stopping at the first red (first parents only, so the branch commits of a PR
merged into `main` are never read as `main`'s own), and it is already fixed on
`main` when that name reads passing on `main`'s current tip (`git rev-parse
origin/main`) from a merge-queue run. A passing read on `main`'s tip counts only
when at least one check run of that name concluded success in a merge-queue run:
the check run's `check_suite.id`, from the check-runs read, equals the
`check_suite_id` of a workflow run on that sha whose `event` reads
`merge_group`, from `gh api --paginate
'repos/{owner}/{repo}/actions/runs?head_sha=<sha>'`. No other run counts: the
fields these reads return cannot tell a scheduled or dispatched full run from a
refresh run, and a refresh run runs no test legs yet reports the required
summaries green. Where none of those commits shows that name red, or that name
does not read passing on `main`'s current tip from a merge-queue run (red,
pending, not reported, unread, reported only by a status, passing only from
another run, or a tip with no merge-queue run, as a merge that bypassed the
queue leaves), the stop stands and goes to the operator as every other stop
does. Send the new-head round only when, after the same fetch, `git merge-tree
--write-tree --name-only --no-messages origin/main <handoffCommit>` exits 0:
exit 1 (a conflict) or any other answer leaves the stop standing for the
operator. The one rerun the RED bullet allows does not clear a red that is
`main`'s own, and no close and reopen does either: a rerun replays its run's
original merge commit, which still carries `main`'s red, and a close and reopen
of the PR can race GitHub's recompute of the merge ref. Where you take the
route, say so in your turn's text with the reads that showed it.

**The latest attempt decides** (D-7546, which amends the strict reading of
D-7495). The verdict judges the latest attempt of each required name, which is
GitHub's own merge rule and all read 5 lists: `commits/<sha>/check-runs` with no
`filter` answers only the newest run of each name, so a name that failed and
then passed on a rerun of the same head reads passing. So a red that the one
rerun the RED bullet allows turns green is cleared. A red that no rerun reaches,
or one still red after that rerun, stays the stop `red-unreachable`. Before each
enqueue, direct merge and re-enqueue, read every attempt as well, with `gh api
--paginate
'repos/{owner}/{repo}/commits/<handoffCommit>/check-runs?filter=all'`, and name
in your turn's text, apart from the verdict's line, each check name of which any
completed run concluded other than success, neutral or skipped, or none. That
line is a report: it is never a stop and decides nothing, and a read of it that
fails is named as unread and is no stop either.
