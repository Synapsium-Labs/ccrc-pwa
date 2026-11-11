#!/usr/bin/env bash
# rig.sh — the delegation broker's capture rig (wave 1; spec 2026-10-04 §8.1-§8.2).
#
# Runs an INSTALLED Claude Code binary against mockapi.mjs inside a PRIVATE tmux server and a
# FIXTURE HOME, with ccrc's own session-hook.sh registered by ccrc's own installer, in a tmux
# session named cc-rig-hookcap — so the hook's -hookcap capture arm records every payload. The
# real HOME is read for ONE thing, the binary's directory; nothing is written outside the run root.
#
#   rig.sh guard-root <path>         exit 0 iff <path> may be a run root: absolute, canonical
#                                    spelling, basename ccrc-dlg-rig.*, not $HOME and not under it
#   rig.sh guard-sock <name>         exit 0 iff <name> matches ^dlg[A-Za-z0-9_-]*$
#   rig.sh check-scenario <file>     exit 0 iff every step is well formed (verbs, integers, key names)
#   rig.sh setup <root> [<version>]  fixture HOME <root>/fixhome (config <root>/fixhome/cfg), repo <root>/repo
#   rig.sh run <version> <scenario.json> <out-dir>   one run; a raw bundle lands in <out-dir>
#   rig.sh print-launch <version> <scenario.json> <root>   set up <root> as a run would, then print the pane's
#                                    launch line (port 0) without starting anything: the launch block's proof
#                                    A scenario may carry `launch` {args, env, settings, files}, `capS`, `timing`
#                                    and `requests` (README.md); flags and env names only from RIG_LAUNCH_FLAGS
#                                    and RIG_LAUNCH_ENV; a permission bypass only under scenarios-overlord/
#   rig.sh all <raw-root> [<version>...]   reap, then every installed version (or only those named, each checked
#                                    first) x every scenario -> <raw-root>/<v>/<s>/, then <raw-root>/.done; exit 1 if any run failed
#   rig.sh versions [<version>...]   the versions `all` would cover, one per line: every installed one, or the ones named
#                                    (each must be installed). Installed = x.y.z-shaped and executable under the real HOME's
#                                    ~/.local/share/claude/versions (none there: none; unreadable there: exit 2). recapture.sh asks this too.
#   rig.sh reap                      remove what killed runs left: dlg<pid> tmux servers and
#                                    ccrc-dlg-rig.* roots whose owning rig.sh pid is gone, or that have
#                                    no .owner, nothing modified for 10 minutes and no process under them
#                                    (and a box with no /proc, where that cannot be measured, keeps them)
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TREE=$(cd "$HERE/../../.." && pwd)
REAL_HOME=$HOME
VERSIONS=$REAL_HOME/.local/share/claude/versions
SOCK_RE='^dlg[A-Za-z0-9_-]*$'
VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+$'
SESSION=cc-rig-hookcap
VERBS='waitReady type keys waitLabels probeLabels answerDialog sleep kill9 swapConfig relaunch snapshot sessionsSnap'
# The Overlord's W0 launch block (plan 2026-11-10-overlord/w0-spike.md, Task 2): the ONLY flags a scenario's launch.args may
# carry, and the ONLY env names its launch.env may set. Each flag is in Claude Code's CLI reference (W0 Task 1 Step 2).
RIG_LAUNCH_FLAGS='--setting-sources --settings --mcp-config --strict-mcp-config --agents --allowedTools --disallowedTools --permission-mode --dangerously-skip-permissions --model --tools --autocompact --append-system-prompt --disable-slash-commands'
RIG_LAUNCH_ENV='RIG_EMIT_LOG RIG_STATUS_LOG DOOR_LOG DOOR_NONCE CLAUDE_CODE_DISABLE_AUTO_MEMORY CLAUDE_CODE_FORK_SUBAGENT CLAUDE_CODE_DISABLE_AGENT_VIEW CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS CLAUDE_CODE_SUBAGENT_MODEL CLAUDE_CODE_SUBAGENT_MODEL_FORCE CLAUDE_CODE_AUTO_COMPACT_WINDOW CLAUDE_AUTOCOMPACT_PCT_OVERRIDE DISABLE_AUTO_COMPACT CLAUDE_CODE_DISABLE_CRON CLAUDE_CODE_DISABLE_BACKGROUND_TASKS CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK'
RUN_CAP_S=1200

die() { printf 'rig: %s\n' "$*" >&2; exit 2; }
guard_root() {
  local r=${1-} b h x
  [[ $r == /* && $r != */ && $r != *//* ]] || return 1
  [[ /$r/ != */./* && /$r/ != */../* ]] || return 1
  b=${r##*/}
  [[ $b == ccrc-dlg-rig.?* ]] || return 1
  h=$(cd -P -- "$REAL_HOME" 2>/dev/null && pwd) || h=""
  for x in "${REAL_HOME%/}" "${h%/}"; do
    [[ -n $x ]] || return 1
    [[ $r != "$x" && $r != "$x"/* ]] || return 1
  done
  return 0
}
# The directory run roots are made in (and reaped from): ${TMPDIR:-/tmp}, unless that sits at or under
# $HOME by its spelling OR its physical path (a fleet session's TMPDIR does), where guard_root would
# refuse every root: then /tmp. The two arms mirror guard_root's own.
run_base() {
  local b=${TMPDIR:-/tmp} p h x
  p=$(cd -P -- "$b" 2>/dev/null && pwd) || { printf '/tmp'; return 0; }
  h=$(cd -P -- "$REAL_HOME" 2>/dev/null && pwd) || h=""
  for x in "${REAL_HOME%/}" "${h%/}"; do
    [[ -n $x ]] || continue
    if [[ $p == "$x" || $p == "$x"/* || $b == "$x" || $b == "$x"/* ]]; then printf '/tmp'; return 0; fi
  done
  printf '%s' "${b%/}"
}
guard_sock() { [[ ${1-} =~ $SOCK_RE ]]; }
# An installed Claude Code version: x.y.z-shaped (it names a file under $VERSIONS, so no `..` and no `/`) and executable there.
version_ok() { [[ ${1-} =~ $VERSION_RE && -x $VERSIONS/${1-} ]]; }
need_version() { version_ok "${1-}" || die "'${1-}' is not an installed Claude Code version under $VERSIONS (x.y.z, executable)"; }
# The entries of $VERSIONS, into LISTED (one per line). A versions directory that is ABSENT is "none installed": LISTED stays empty.
# One that cannot be READ is not that answer, it is a failure to measure, and it ends the run (exit 2): a directory that cannot be both
# listed and searched, a path that is not a directory (a file, a link to nothing), or one under a parent that cannot be searched. `-e`
# is as false under such a parent as for an absent path, so when nothing answers at the path the nearest entry above it that does
# decides: absent means that entry is a directory this user can search. D-3999: every one of these read as none installed, and
# `rig.sh all` with no version named then captured nothing, wrote .done and exited 0. Call it in the MAIN shell, as pick_versions
# does: a `die` in $( ) ends only that subshell.
LISTED=""
list_versions() {
  local up=$VERSIONS
  LISTED=""
  if [[ -d $VERSIONS ]]; then
    [[ -r $VERSIONS && -x $VERSIONS ]] || die "cannot read the versions directory $VERSIONS: it cannot be both listed and searched (a failure, not 'none installed')"
    LISTED=$(ls -- "$VERSIONS" 2>/dev/null) || die "cannot read the versions directory $VERSIONS: listing it failed (a failure, not 'none installed')"
  else
    while [[ ! -e $up && ! -L $up ]]; do up=$(dirname -- "$up"); done   # ends at an entry that exists: dirname's fixed points are . and /
    if [[ ! -d $up || ! -x $up ]]; then die "cannot read the versions directory $VERSIONS: '$up' is not a directory that can be searched (a failure, not 'none installed')"; fi
  fi
}
# The versions one capture covers, into VERS: numeric order, each once. None named = every installed one. Named ones are ALL
# checked first and the first bad one refused. Call it in the MAIN shell, never inside $( ) or < <( ): a `die` there ends only
# that subshell (review 304 F7 was exactly that), so `rig.sh versions` and cmd_all call it directly.
VERS=()
pick_versions() {
  local v
  VERS=()
  if (( $# )); then
    for v in "$@"; do need_version "$v"; done
    while IFS= read -r v; do VERS+=("$v"); done < <(printf '%s\n' "$@" | sort -t. -k1,1n -k2,2n -k3,3n | uniq)
  else
    list_versions
    while IFS= read -r v; do
      if version_ok "$v"; then VERS+=("$v"); fi
    done < <(printf '%s\n' "$LISTED" | sort -t. -k1,1n -k2,2n -k3,3n)
  fi
}
guard_out() {   # an output directory must not sit inside the source tree (raw bundles are never git-add-able)
  local o=${1-} p
  [[ -n $o ]] || return 1
  mkdir -p -- "$o" || return 1
  p=$(cd -P -- "$o" && pwd) || return 1
  [[ $p != "$TREE" && $p != "$TREE"/* ]]
}
# THE ONLY tmux CALL IN THIS FILE: a private server, no config file, socket name guarded.
T() { local s=$1; shift; guard_sock "$s" || die "refusing tmux socket '$s'"; tmux -L "$s" -f /dev/null "$@"; }
rig_uuid() { local u; u=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen); printf '%s' "$u" | tr 'A-Z' 'a-z'; }
# A key-SHAPED placeholder, built at run time, written 0600 under the run root, never into the tree
# and never onto a command line; the mock ignores it.
rig_key() { printf 'sk-ant-api03-%sAA' "$(printf 'r%.0s' $(seq 93))"; }
rig_path() {
  local c d out=""
  for c in jq tmux git timeout gtimeout node curl; do
    d=$(command -v "$c" 2>/dev/null) || continue
    d=${d%/*}
    [[ ":$out:" == *":$d:"* ]] || out=${out:+$out:}$d
  done
  printf '%s:/usr/bin:/bin' "$out"
}
# Scenario steps are DATA that reaches bash arithmetic and tmux argv, so each is checked first:
# a known verb, integers where a number is due, tmux key NAMES only (no `;`, no command text).
check_scenario() {
  local f=${1-} step verb n k
  [[ -f $f ]] || return 1
  jq -e '(.steps | type) == "array" and (.entries | type) == "array"' "$f" >/dev/null 2>&1 || return 1
  while IFS= read -r step; do
    verb=$(jq -r 'keys_unsorted[0]' <<<"$step")
    [[ " $VERBS " == *" $verb "* ]] || return 1
    for n in waitReady sleep timeoutS; do
      k=$(jq -r --arg n "$n" 'if has($n) then .[$n] | tostring else "" end' <<<"$step")
      [[ -z $k || $k =~ ^[0-9]{1,5}$ ]] || return 1
    done
    if [[ $verb == keys ]]; then
      jq -e '(.keys | type) == "array" and (.keys | length) > 0 and all(.keys[]; type == "string" and test("^[A-Za-z][A-Za-z0-9-]{0,15}$"))' <<<"$step" >/dev/null || return 1
    fi
    if [[ $verb == waitLabels || $verb == probeLabels ]]; then
      jq -e --arg v "$verb" '(.[$v] | type) == "array" and all(.[$v][]; type == "string" and test("^[a-z0-9-]{1,40}$"))' <<<"$step" >/dev/null || return 1
    fi
    for n in type answerDialog; do   # typed into the pane / matched on it: a single-line string
      jq -e --arg n "$n" 'if has($n) then (.[$n] | type == "string" and (test("[\n\r]") | not)) else true end' <<<"$step" >/dev/null || return 1
    done
    if [[ $verb == snapshot ]]; then jq -e '.snapshot | type == "string" and test("^[a-z0-9-]{1,40}$")' <<<"$step" >/dev/null || return 1; fi
    if [[ $verb == sessionsSnap ]]; then jq -e '.sessionsSnap | type == "string" and test("^[a-z0-9-]{1,40}$")' <<<"$step" >/dev/null || return 1; fi
    if [[ $verb == relaunch ]]; then jq -e '.relaunch == true or .relaunch == {mode: "fresh"} or .relaunch == {mode: "fork"}' <<<"$step" >/dev/null || return 1; fi
  done < <(jq -c '.steps[]' "$f")
  k=$(jq -r '.settleS // 8 | tostring' "$f"); [[ $k =~ ^[0-9]{1,5}$ ]] || return 1
  check_launch "$f" || return 1
  return 0
}
# The W0 launch block (README.md): every flag on RIG_LAUNCH_FLAGS (a `--flag=value` spelling by its name) and every value
# after a flag; every env name on RIG_LAUNCH_ENV and none reserved, in launch.env or in launch.settings.env (either would
# point the binary away from the mock or the fixture); file paths relative, with no `..` segment; capS 60 to 5400. A
# permission bypass (the flag, the mode, or the settings' default mode) only in a file under scenarios-overlord/ (D-8203):
# the delegation corpus measures ccrc's granted launch and stays bypass-free.
RESERVED_ENV_RE='^(PATH|HOME|TMPDIR|CLAUDE_CONFIG_DIR|ANTHROPIC_.*)$'
check_launch() {
  local f=$1 dir
  jq -e --arg flags "$RIG_LAUNCH_FLAGS" --arg envs "$RIG_LAUNCH_ENV" --arg reserved "$RESERVED_ENV_RE" '
    def line: type == "string" and (test("[\n\r]") | not);
    ($flags | split(" ")) as $F | ($envs | split(" ")) as $E
    | (if has("launch") then (.launch | type == "object" and ((keys - ["args", "env", "settings", "files"]) == [])) else true end)
    and ((.launch.args // []) as $a | ($a | type == "array") and all($a[]; line)
         and ([range(0; $a | length) as $i | $a[$i] as $x
               | if ($x | startswith("-")) then ($x | split("=") | .[0]) as $n | any($F[]; . == $n) else $i > 0 end] | all))
    and ((.launch.env // {}) as $e | ($e | type == "object")
         and all($e | to_entries[]; (.value | line) and (.key as $k | any($E[]; . == $k)) and (.key | test($reserved) | not)))
    and ((.launch.settings // {}) | type == "object"
         and ((.env // {}) | type == "object" and all(keys[]; test($reserved) | not))
         and ((.hooks // {}) | type == "object" and all(.[]; type == "array")))
    and ((.launch.files // []) as $fs | ($fs | type == "array") and all($fs[]; type == "object"
         and (.in == "cfg" or .in == "repo")
         and (.path | type == "string" and test("^[A-Za-z0-9._/-]{1,200}$") and (startswith("/") | not) and ((split("/") | index("..")) == null))
         and (.text | type == "string") and ((.exec // false) | type == "boolean")))
    and (if has("capS") then (.capS | type == "number" and . == floor and . >= 60 and . <= 5400) else true end)
    and (if has("timing") then (.timing | type == "boolean") else true end)
    and (if has("requests") then (.requests | type == "boolean") else true end)
  ' "$f" >/dev/null 2>&1 || return 1
  if jq -e '((.launch.args // []) as $a
              | any($a[]; . == "--dangerously-skip-permissions" or . == "--permission-mode=bypassPermissions")
                or any(range(0; ($a | length) - 1); $a[.] == "--permission-mode" and $a[. + 1] == "bypassPermissions"))
            or ((try .launch.settings.permissions.defaultMode catch null) == "bypassPermissions")' "$f" >/dev/null 2>&1; then
    dir=$(cd "$(dirname "$f")" && pwd -P) || return 1
    [[ ${dir##*/} == scenarios-overlord ]] || return 1
  fi
  return 0
}

# The launch block's five placeholders, replaced LITERALLY in every string of the JSON on stdin; no other expansion.
# <root> is the run root; the rest derive from it as cmd_setup lays it out.
launch_subst() {
  local R=$1
  jq --arg root "$R" --arg home "$R/fixhome" --arg cfg "$R/fixhome/cfg" --arg repo "$R/repo" --arg stubs "$HERE/stubs" '
    walk(if type == "string" then
           gsub("@RIG_ROOT@"; $root) | gsub("@RIG_HOME@"; $home) | gsub("@RIG_CFG@"; $cfg) | gsub("@RIG_REPO@"; $repo)
           | gsub("@RIG_STUBS@"; $stubs)
         else . end)'
}
g() { local R=$1; shift; HOME=$R/fixhome GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -c core.hooksPath=/dev/null -C "$R/repo" "$@"; }
cmd_setup() {
  local R=${1-} V=${2:-0.0.0} H phys
  guard_root "$R" || die "refusing root '$R': it must be absolute, canonical, named ccrc-dlg-rig.*, and outside \$HOME"
  # The spelling passed; the PHYSICAL path (the root, else its parent, resolved through any symlink) must too.
  if [[ -e $R ]]; then phys=$(cd -P -- "$R" 2>/dev/null && pwd) || die "cannot resolve root '$R'"
  elif [[ -d ${R%/*} ]]; then phys=$(cd -P -- "${R%/*}" 2>/dev/null && pwd)/${R##*/} || die "cannot resolve root '$R'"
  else phys=$R; fi
  guard_root "$phys" || die "refusing root '$R': it resolves to '$phys', which the guard refuses"
  H=$R/fixhome
  mkdir -p "$H/cfg" "$H/.cc-sessions" "$H/.ccrc" "$R/repo" "$R/tmp"
  if [[ ! -d $R/repo/.git ]]; then
    g "$R" init -q -b main
    g "$R" config user.name 'Rig Fixture'
    g "$R" config user.email 'you@example.com'
    g "$R" config commit.gpgsign false
    printf '# rig fixture repo\n' > "$R/repo/README.md"
    g "$R" add README.md
    GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z g "$R" commit -q -m 'fixture: initial commit'
  fi
  cp "$TREE/ccd/session-hook.sh" "$H/.cc-sessions/session-hook.sh"
  rig_uuid > "$H/.cc-sessions/rig-hookcap.generation"
  ( umask 077; rig_key > "$R/key" )
  # Tools are GRANTED, never bypassed: no permission-bypass flag anywhere in this rig.
  jq -n '{env: {DISABLE_AUTOUPDATER: "1"}, enableWorkflows: true, worktree: {baseRef: "head"},
          permissions: {defaultMode: "default", disableAutoMode: "disable", allow: ["Bash", "Read", "Write", "Edit", "Agent", "Task", "Workflow"]}}' > "$H/cfg/settings.json"
  HOME=$H bash "$TREE/ccd/install-session-hooks.sh" --homes "$H/cfg" >/dev/null
  # A scenario's launch.settings (W0): merged over the fixture with jq's `*`, except that each hooks.<event> array is
  # APPENDED to the fixture's, so ccrc's own hook stays registered. No launch block: the file is untouched.
  if [[ -n ${SCEN-} ]] && jq -e '.launch.settings | type == "object"' "$SCEN" >/dev/null 2>&1; then
    jq '.launch.settings' "$SCEN" | launch_subst "$R" > "$R/launch-settings.json"
    jq --slurpfile l "$R/launch-settings.json" '
      ($l[0]) as $s
      | (. * ($s | del(.hooks)))
      | reduce (($s.hooks // {}) | to_entries[]) as $h (.; .hooks[$h.key] = ((.hooks[$h.key] // []) + $h.value))' \
      "$H/cfg/settings.json" > "$H/cfg/settings.json.w0" && mv "$H/cfg/settings.json.w0" "$H/cfg/settings.json"
  fi
  jq -n --arg tail "$(tail -c 20 "$R/key")" --arg repo "$R/repo" --arg v "$V" '{
      numStartups: 5, hasCompletedOnboarding: true, firstStartTime: "2026-01-01T00:00:00.000Z",
      lastOnboardingVersion: $v, lastReleaseNotesSeen: $v, lastClawdEntranceVersion: $v,
      fullscreenUpsellSeenCount: 3, officialMarketplaceAutoInstallAttempted: true,
      customApiKeyResponses: {approved: [$tail], rejected: []},
      projects: {($repo): {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true,
                           projectOnboardingSeenCount: 5, allowedTools: []}}}' > "$H/cfg/.claude.json"
  # A scenario's launch.files (W0), last, so a file may stand in for anything above: each under cfg/ or repo/, by a path
  # check_launch already held to relative and `..`-free; mode 0755 when `exec` is true.
  if [[ -n ${SCEN-} ]] && jq -e '(.launch.files // []) | length > 0' "$SCEN" >/dev/null 2>&1; then
    local i n in path dest
    n=$(jq '.launch.files | length' "$SCEN")
    for (( i = 0; i < n; i++ )); do
      in=$(jq -r --argjson i "$i" '.launch.files[$i].in' "$SCEN"); path=$(jq -r --argjson i "$i" '.launch.files[$i].path' "$SCEN")
      case $in in cfg) dest=$H/cfg/$path ;; repo) dest=$R/repo/$path ;; *) die "launch.files[$i]: in must be cfg or repo" ;; esac
      mkdir -p "$(dirname "$dest")"
      jq --argjson i "$i" '.launch.files[$i].text' "$SCEN" | launch_subst "$R" | jq -j . > "$dest"
      if jq -e --argjson i "$i" '.launch.files[$i].exec == true' "$SCEN" >/dev/null; then chmod 0755 "$dest"; fi
    done
  fi
}

# ── run ─────────────────────────────────────────────────────────────────────────────
VER="" SCEN="" RUN_R="" RUN_H="" SOCK="" CFG="" PORT="" MOCK_PID="" OUT_DIR="" COLLECTED=0 TIMING=0
LAUNCH_ARGS=() LAUNCH_ENV=()
# The scenario's checked launch.args and launch.env (as NAME=value), placeholders replaced for this run root. A scenario
# with no launch block leaves both empty, so its launch line is byte-identical to the one before the block existed.
load_launch() {
  LAUNCH_ARGS=(); LAUNCH_ENV=()
  mapfile -t LAUNCH_ARGS < <(jq '.launch.args // []' "$SCEN" | launch_subst "$RUN_R" | jq -r '.[]')
  mapfile -t LAUNCH_ENV < <(jq '.launch.env // {}' "$SCEN" | launch_subst "$RUN_R" | jq -r 'to_entries[] | "\(.key)=\(.value)"')
}
# W0's `timing: true`: each step's start and waitReady's elapsed milliseconds, in their OWN file. Not `note`: the notes file
# is the run's failure-and-outcome channel that build-matrix.mjs reads, and a timing line there would read as a failure.
timing() { printf '%s\n' "$*" >> "$RUN_R/timing"; }
note() { printf '%s\n' "$*" >> "$RUN_R/notes"; }
pane() { T "$SOCK" capture-pane -p -t "$SESSION" 2>/dev/null || true; }
wait_text() {
  local text=$1 end=$(( $(date +%s) + $2 ))
  while (( $(date +%s) <= end )); do pane | grep -qF -- "$text" && return 0; sleep 0.25; done
  return 1
}
# The ready prompt's footer: "? for shortcuts" on older builds, a "<mode> on" line on newer ones
# (2.1.289: "manual mode on"). The version banner alone is not ready: the input box follows it.
wait_ready() {
  local end=$(( $(date +%s) + $1 ))
  while (( $(date +%s) <= end )); do pane | grep -qE '\? for shortcuts|(manual|plan|auto) mode on|accept edits on' && return 0; sleep 0.25; done
  return 1
}
wait_labels() {
  local want=$1 end=$(( $(date +%s) + $2 ))
  while (( $(date +%s) <= end )); do
    curl -fsS "http://127.0.0.1:$PORT/__rig/state" 2>/dev/null \
      | jq -e --argjson w "$want" '($w - .consumedLabels) == []' >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}
# The session to resume: the payload session_id of the newest MAIN-thread capture (no agent_id) —
# whether a subagent's events carry the parent's id is one of the questions being measured.
current_sid() {
  local f
  while IFS= read -r f; do
    sed -n 2p "$f" | jq -er 'select(((.agent_id // "") | tostring) == "") | .session_id // empty' 2>/dev/null && return 0
  done < <(ls -1 "$RUN_H/.ccrc/hook-capture/rig-hookcap"/*.cap 2>/dev/null \
           | awk -F/ '{n=$NF; split(n, p, "-"); print p[2] "\t" $0}' | sort -rn | cut -f2)
  return 1
}
# The Claude Code process of the pane: the pane's process when it is the binary, else its child
# that is (the launch line runs the binary under `timeout`). Linux identifies by /proc/<pid>/exe.
claude_pid() {
  local p dead c exe vd
  read -r dead p < <(T "$SOCK" display-message -p -t "$SESSION" '#{pane_dead} #{pane_pid}') || return 1
  [[ $dead == 0 && $p =~ ^[0-9]+$ ]] || return 1
  # /proc/<pid>/exe is always PHYSICAL and $VERSIONS is spelled from $REAL_HOME, so compare against the resolved
  # directory (as guard_root and run_base resolve HOME); one that cannot be resolved keeps its spelling, never wider.
  vd=$(cd -P -- "$VERSIONS" 2>/dev/null && pwd) || vd=$VERSIONS
  for c in "$p" $(pgrep -P "$p" 2>/dev/null); do
    exe=$(readlink "/proc/$c/exe" 2>/dev/null) || exe=""
    if [[ -z $exe && ! -d /proc ]]; then [[ $c != "$p" ]] && { printf '%s' "$c"; return 0; }; continue; fi
    [[ $exe == "$vd"/* ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
launch_cmd() {   # [claude args...] -> one shell command line for the pane (run by `bash -c`)
  local bin=$VERSIONS/$VER gen args="" a to="" lenv=""
  # This die runs inside a command substitution (`bash -c "$(launch_cmd)"`), so its exit 2 ends only that subshell and the run
  # carries on with an empty command: cmd_run refuses a missing binary up front, and this is what is left for `relaunch`.
  [[ -x $bin ]] || die "no Claude Code binary '$VER' under $VERSIONS"
  gen=$(cat "$RUN_H/.cc-sessions/rig-hookcap.generation")
  for a in ${LAUNCH_ARGS[@]+"${LAUNCH_ARGS[@]}"} "$@"; do args+=" $(printf '%q' "$a")"; done
  for a in ${LAUNCH_ENV[@]+"${LAUNCH_ENV[@]}"}; do lenv+="${a%%=*}=$(printf '%q' "${a#*=}") "; done
  if command -v timeout >/dev/null 2>&1; then to="timeout -k 10 $RUN_CAP_S "; elif command -v gtimeout >/dev/null 2>&1; then to="gtimeout -k 10 $RUN_CAP_S "; fi
  # TMUX/TMUX_PANE are expanded by the PANE's bash: inside this private server they name the
  # private socket, so the hook's own display-message asks the rig, never the default server.
  # The key is read from its 0600 file by that bash, so it never appears on a command line.
  printf 'cd %q && exec env -i PATH=%q TERM=tmux-256color LANG=C.UTF-8 LC_ALL=C.UTF-8 HOME=%q TMPDIR=%q CLAUDE_CONFIG_DIR=%q ANTHROPIC_API_KEY="$(cat %q)" ANTHROPIC_BASE_URL=http://127.0.0.1:%s DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_NO_FLICKER=0 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CCRC_SESSION_GENERATION=%q TMUX="$TMUX" TMUX_PANE="$TMUX_PANE" %s%s%q%s' \
    "$RUN_R/repo" "$(rig_path)" "$RUN_H" "$RUN_R/tmp" "$CFG" "$RUN_R/key" "$PORT" "$gen" "$lenv" "$to" "$bin" "$args"
}
snapshot() {   # <name>: the admin records and the .claude/worktrees entries, at this instant
  local d=$RUN_R/snapshots/$1
  mkdir -p "$d"
  { ls -A "$RUN_R/repo/.git/worktrees" 2>/dev/null || true; } > "$d/admin-records"
  { ls -A "$RUN_R/repo/.claude/worktrees" 2>/dev/null || true; } > "$d/worktrees"
}
sessions_snap() {   # <name>: Claude Code's live-session records and the transcript names, at this instant (W0-05)
  local d=$RUN_R/snapshots/$1
  mkdir -p "$d/sessions"
  cp "$CFG"/sessions/*.json "$d/sessions/" 2>/dev/null || true
  { cd "$CFG/projects" 2>/dev/null && find . -mindepth 2 -maxdepth 2 -name '*.jsonl' -type f | sed 's|^\./||' | sort || true; } > "$d/transcripts"
}
run_steps() {
  local step verb sid pid i=0 t0 mode
  while IFS= read -r step; do
    verb=$(jq -r 'keys_unsorted[0]' <<<"$step")
    i=$((i + 1))
    if (( ${TIMING:-0} )); then t0=$(date +%s%3N); timing "step $i $verb start $t0"; fi
    case $verb in
      waitReady)    wait_ready "$(jq -r .waitReady <<<"$step")" || note "waitReady: no ready prompt"
                    if (( ${TIMING:-0} )); then timing "step $i waitReady elapsed $(( $(date +%s%3N) - t0 ))"; fi ;;
      type)         T "$SOCK" send-keys -t "$SESSION" -l -- "$(jq -r .type <<<"$step")" ;;
      keys)         mapfile -t ks < <(jq -r '.keys[]' <<<"$step"); T "$SOCK" send-keys -t "$SESSION" "${ks[@]}" ;;
      waitLabels)   wait_labels "$(jq -c .waitLabels <<<"$step")" "$(jq -r '.timeoutS // 120' <<<"$step")" \
                      || note "waitLabels $(jq -c .waitLabels <<<"$step"): timeout" ;;
      probeLabels)  wait_labels "$(jq -c .probeLabels <<<"$step")" "$(jq -r '.timeoutS // 120' <<<"$step")" \
                      || note "probe $(jq -c .probeLabels <<<"$step"): not reached" ;;
      answerDialog) if wait_text "$(jq -r .answerDialog <<<"$step")" "$(jq -r '.timeoutS // 10' <<<"$step")"; then
                      T "$SOCK" send-keys -t "$SESSION" Enter; note "dialog answered: $(jq -r .answerDialog <<<"$step")"
                    else note "answerDialog: no dialog: $(jq -r .answerDialog <<<"$step")"
                    fi ;;
      sleep)        sleep "$(jq -r .sleep <<<"$step")" ;;
      kill9)        if pid=$(claude_pid); then kill -9 "$pid"; else note "kill9: no pid"; fi ;;
      swapConfig)   mkdir -p "$RUN_H/cfg2"; cp -a "$RUN_H/cfg/." "$RUN_H/cfg2/"; CFG=$RUN_H/cfg2 ;;
      relaunch)     mode=$(jq -r 'if .relaunch == true then "resume" else .relaunch.mode end' <<<"$step")
                    if [[ $mode == fresh ]]; then
                      T "$SOCK" respawn-pane -k -t "$SESSION" bash -c "$(launch_cmd)"
                    elif sid=$(current_sid) && [[ -n $sid ]]; then
                      if [[ $mode == fork ]]; then T "$SOCK" respawn-pane -k -t "$SESSION" bash -c "$(launch_cmd --resume "$sid" --fork-session)"
                      else T "$SOCK" respawn-pane -k -t "$SESSION" bash -c "$(launch_cmd --resume "$sid")"; fi
                    else note "relaunch: no session id captured"; fi ;;
      snapshot)     snapshot "$(jq -r .snapshot <<<"$step")" ;;
      sessionsSnap) sessions_snap "$(jq -r .sessionsSnap <<<"$step")" ;;
      *)            note "unknown step verb $verb" ;;
    esac
  done < <(jq -c '.steps[]' "$SCEN")
}
collect() {
  local O=$1 a n f c m
  COLLECTED=1
  mkdir -p "$O/caps" "$O/admin" "$O/meta" "$O/snapshots"
  printf '%s\n%s\n' "$RUN_R" "$(cd -P "$RUN_R" && pwd)" > "$O/root"
  printf '%s\n' "$VER" > "$O/version"
  printf '%s\n' "$VERSIONS" > "$O/versions-dir"
  basename "$SCEN" .json > "$O/scenario"
  cp "$RUN_H"/.ccrc/hook-capture/rig-hookcap/*.cap "$O/caps/" 2>/dev/null || true
  for a in "$RUN_R"/repo/.git/worktrees/*/; do
    [[ -d $a ]] || continue
    n=$(basename "$a"); mkdir -p "$O/admin/$n"
    ls -A "$a" > "$O/admin/$n/files"
    for f in gitdir HEAD CLAUDE_BASE locked; do [[ -f $a/$f ]] && cp "$a/$f" "$O/admin/$n/$f"; done
    # The first reflog line names the creator (`Rig Fixture <you@example.com>`); keep its NEW sha only.
    [[ -f $a/logs/HEAD ]] && head -n 1 "$a/logs/HEAD" | awk '{print $2}' > "$O/admin/$n/first-log-sha"
  done
  { ls -A "$RUN_R/repo/.claude/worktrees" 2>/dev/null || true; } > "$O/worktrees-left"
  g "$RUN_R" worktree list --porcelain > "$O/worktree-list" 2>/dev/null || true
  g "$RUN_R" for-each-ref --format='%(refname:short)' refs/heads > "$O/branches" 2>/dev/null || true
  for c in "$RUN_H/cfg" "$RUN_H/cfg2"; do
    [[ -d $c/projects ]] || continue
    while IFS= read -r m; do
      mkdir -p "$O/meta/${c##*/}/$(dirname "$m")"; cp "$c/projects/$m" "$O/meta/${c##*/}/$m"
    done < <(cd "$c/projects" && find . -path '*/subagents/*' -name '*.meta.json' -type f)
  done
  [[ -d $RUN_R/snapshots ]] && cp -R "$RUN_R/snapshots/." "$O/snapshots/"
  curl -fsS "http://127.0.0.1:$PORT/__rig/state" 2>/dev/null | jq -c '.consumedLabels' > "$O/labels" || printf '[]\n' > "$O/labels"
  if [[ -f $RUN_R/notes ]]; then cp "$RUN_R/notes" "$O/notes"; else : > "$O/notes"; fi
  # W0: the mock's request dumps (a scenario with requests: true), the step timings and the stubs' logs, when the run made them.
  if [[ -d $RUN_R/reqs ]]; then mkdir -p "$O/reqs"; cp -R "$RUN_R/reqs/." "$O/reqs/"; fi
  if [[ -f $RUN_R/timing ]]; then cp "$RUN_R/timing" "$O/timing"; fi
  if [[ -d $RUN_R/logs ]]; then mkdir -p "$O/logs"; cp -R "$RUN_R/logs/." "$O/logs/"; fi
  return 0
}
# Pids (never this shell's own) whose working directory is at or under <root>, by /proc (Linux, as
# claude_pid already is). A process whose cwd was REMOVED reads "<path> (deleted)": it still matches when
# the cwd was a directory under the root (the suffix follows the path), but not when the cwd was the root
# itself, which is harmless because the wait runs BEFORE the rm. Every caller passes a root that guard_root
# accepted, so this never names a foreign process.
procs_under() {
  local root=${1%/} l p c
  [[ -n $root ]] || return 0
  while IFS= read -r l; do
    p=${l%% *}; c=${l#* }; p=${p#/proc/}
    [[ $p == "$$" || $p == "$BASHPID" ]] && continue
    [[ $c == "$root" || $c == "$root"/* ]] && printf '%s\n' "$p"
  done < <(find /proc -mindepth 2 -maxdepth 2 -name cwd -printf '%h %l\n' 2>/dev/null)
  return 0
}
# <pid> and all its descendants, one per line.
pid_tree() {
  local c
  printf '%s\n' "$1"
  for c in $(pgrep -P "$1" 2>/dev/null); do pid_tree "$c"; done
}
# SIGKILL <pid> only if its cwd is STILL at or under <root>: re-read right before the signal, so a pid
# the kernel recycled between the scan and the kill is never hit.
kill_if_under() {
  local c
  c=$(readlink "/proc/$1/cwd" 2>/dev/null) || return 0
  [[ $c == "$2" || $c == "$2"/* ]] && kill -9 "$1" 2>/dev/null || true
}
pid_live() { kill -0 "$1" 2>/dev/null && ! grep -q '^State:[[:space:]]*Z' "/proc/$1/status" 2>/dev/null; }
# Wait (bounded) until nothing tied to this run is left to write under its root: the pane's pid tree
# captured before the server died, and any process whose cwd is under the root. A late flush from a
# dying Claude Code recreated the removed root once (measured, 98-run capture), and reap, which keys on
# .owner, then skipped it for good. A straggler past the bound is SIGKILLed by its cwd alone.
wait_run_quiet() {
  local root=$1 tree=$2 end=$(( SECONDS + ${RUN_QUIET_S:-10} )) p alive stage=0
  while :; do
    alive=0
    for p in $tree; do pid_live "$p" && alive=1; done
    [[ -n $(procs_under "$root") ]] && alive=1
    (( alive )) || return 0
    if (( SECONDS >= end )); then
      (( stage )) && { printf 'rig: processes still hold run root %s\n' "${root##*/}" >&2; return 0; }
      for p in $(procs_under "$root"); do kill_if_under "$p" "${root%/}"; done
      stage=1; end=$(( SECONDS + 3 ))
    fi
    sleep 0.2
  done
}
cleanup_run() {
  local tree="" pp _
  if [[ $COLLECTED == 0 && -n $OUT_DIR && -n $RUN_R && -d $RUN_R ]]; then note "run aborted"; collect "$OUT_DIR" || true; fi
  if [[ -n $SOCK ]]; then
    pp=$(T "$SOCK" display-message -p -t "$SESSION" '#{pane_pid}' 2>/dev/null) || pp=""
    [[ $pp =~ ^[0-9]+$ ]] && tree=$(pid_tree "$pp")
    T "$SOCK" kill-server 2>/dev/null || true; rm -f -- "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/$SOCK"
  fi
  [[ -n $MOCK_PID ]] && kill "$MOCK_PID" 2>/dev/null || true
  if [[ -n $RUN_R ]] && guard_root "$RUN_R"; then
    wait_run_quiet "$RUN_R" "$tree"
    # Without /proc the wait above could not see a process by its cwd: never rm what cannot be measured.
    if [[ ! -d ${RIG_PROC_ROOT:-/proc}/self ]]; then
      printf 'rig: no /proc to measure processes under run root %s; leaving it\n' "${RUN_R##*/}" >&2
      return 0
    fi
    for _ in 1 2 3 4 5 6; do rm -rf -- "$RUN_R" 2>/dev/null && break; sleep 2; done
    # a writer that slipped past the wait recreates the tree: a short grace, removing it again
    for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 0.2; [[ -e $RUN_R ]] && rm -rf -- "$RUN_R" 2>/dev/null; done
    [[ ! -e $RUN_R ]] || printf 'rig: could not remove run root %s\n' "${RUN_R##*/}" >&2
  fi
}
cmd_run() {
  VER=${1-}; SCEN=${2-}; OUT_DIR=${3-}
  [[ -n $VER && -n $OUT_DIR ]] || die "usage: rig.sh run <version> <scenario.json> <out-dir>"
  # Before anything is made: a missing binary otherwise runs on with an empty pane command and lands an `unmeasured` bundle.
  need_version "$VER"
  check_scenario "$SCEN" || die "scenario '$SCEN' is malformed (rig.sh check-scenario names the rule)"
  guard_out "$OUT_DIR" || die "refusing out-dir '$OUT_DIR': it must not be inside the source tree"
  local made phys
  made=$(mktemp -d "$(run_base)/ccrc-dlg-rig.XXXXXX") || die "mktemp failed"
  phys=$(cd -P -- "$made" && pwd) || { rmdir -- "$made"; die "cannot resolve '$made'"; }
  guard_root "$phys" || { rmdir -- "$made"; die "refusing run root '$phys' (TMPDIR inside \$HOME?)"; }
  RUN_R=$phys; RUN_H=$RUN_R/fixhome; CFG=$RUN_H/cfg; SOCK=dlg$$
  trap cleanup_run EXIT
  trap 'exit 130' INT TERM HUP
  printf '%s\n' "$$" > "$RUN_R/.owner"
  cmd_setup "$RUN_R" "$VER"
  RUN_CAP_S=$(jq -r --argjson d "$RUN_CAP_S" '.capS // $d' "$SCEN")
  if jq -e '.timing == true' "$SCEN" >/dev/null; then TIMING=1; fi
  load_launch
  if jq -e 'has("launch")' "$SCEN" >/dev/null; then mkdir -p "$RUN_R/logs"; fi
  if jq -e '.requests == true' "$SCEN" >/dev/null; then
    mkdir -p "$RUN_R/reqs"
    MOCK_REQDIR=$RUN_R/reqs MOCK_PORT=0 MOCK_SCRIPT=$SCEN MOCK_LOG=$RUN_R/mock.log node "$HERE/mockapi.mjs" > "$RUN_R/mock.out" 2>&1 &
  else
    MOCK_PORT=0 MOCK_SCRIPT=$SCEN MOCK_LOG=$RUN_R/mock.log node "$HERE/mockapi.mjs" > "$RUN_R/mock.out" 2>&1 &
  fi
  MOCK_PID=$!
  for _ in $(seq 100); do
    PORT=$(sed -n 's/^mock listening 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$RUN_R/mock.out")
    [[ -n $PORT ]] && break; sleep 0.1
  done
  [[ -n $PORT ]] || die "the mock did not start"
  T "$SOCK" start-server ';' set -g remain-on-exit on ';' new-session -d -s "$SESSION" -x 200 -y 50 bash -c "$(launch_cmd)"
  run_steps
  sleep "$(jq -r '.settleS // 8' "$SCEN")"
  collect "$OUT_DIR"
}
# Read-only: the launch line a run of <scenario> on <version> would type into its pane, with port 0, after setting <root> up
# exactly as a run does (so launch.settings and launch.files are applied). Nothing is started.
cmd_print_launch() {
  VER=${1-}; SCEN=${2-}
  local R=${3-}
  [[ -n $VER && -n $SCEN && -n $R ]] || die "usage: rig.sh print-launch <version> <scenario.json> <root>"
  need_version "$VER"
  check_scenario "$SCEN" || die "scenario '$SCEN' is malformed (rig.sh check-scenario names the rule)"
  cmd_setup "$R" "$VER"
  RUN_R=$R; RUN_H=$R/fixhome; CFG=$RUN_H/cfg; PORT=0
  RUN_CAP_S=$(jq -r --argjson d "$RUN_CAP_S" '.capS // $d' "$SCEN")
  load_launch
  launch_cmd
  echo
}
cmd_reap() {
  local d s pid base
  base=${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)
  for s in "$base"/dlg*; do
    [[ -S $s ]] || continue
    s=${s##*/}; pid=${s#dlg}
    [[ $pid =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null || { T "$s" kill-server 2>/dev/null || true; rm -f -- "$base/$s"; printf 'rig: reaped private server %s\n' "$s" >&2; }
  done
  for d in "$(run_base)"/ccrc-dlg-rig.*; do
    [[ -L $d || ! -O $d ]] && continue   # a symlink, or an entry some other user made, is never ours to follow
    [[ -d $d ]] || continue
    if [[ -f $d/.owner ]]; then
      pid=$(cat "$d/.owner")
      [[ $pid =~ ^[0-9]+$ ]] || continue
      kill -0 "$pid" 2>/dev/null && continue
      d=$(cd -P -- "$d" && pwd) || continue
    else
      # No .owner: a late writer (a dying Claude Code's transcript flush) recreated a removed root, or run
      # is between mktemp and writing .owner. Only an AGED root with no process under it is ours to clear.
      # Without /proc procs_under finds nothing, which would read as "no process under it": fail CLOSED.
      [[ -d ${RIG_PROC_ROOT:-/proc}/self ]] || continue
      d=$(cd -P -- "$d" && pwd) || continue
      guard_root "$d" || continue
      [[ -z $(find "$d" -mmin -10 -print -quit 2>/dev/null) ]] || continue
      [[ -z $(procs_under "$d") ]] || continue
    fi
    guard_root "$d" && { rm -rf -- "$d"; printf 'rig: reaped run root %s\n' "${d##*/}" >&2; }
  done
  return 0
}
cmd_all() {
  local RAW=${1-} v s rc total=0 failed=0
  [[ -n $RAW ]] || die "usage: rig.sh all <raw-root> [<version>...]"
  shift
  pick_versions "$@"   # a bad version refuses the whole capture BEFORE anything is made, reaped or removed
  guard_out "$RAW" || die "refusing raw-root '$RAW': it must not be inside the source tree"
  cmd_reap
  rm -f "$RAW/.done"
  for v in ${VERS[@]+"${VERS[@]}"}; do
    for s in "$HERE"/scenarios/*.json; do
      total=$((total + 1))
      # rc is read FIRST: the $(basename) below would reset $? to 0 before the printf expanded it.
      bash "$0" run "$v" "$s" "$RAW/$v/$(basename "$s" .json)" \
        || { rc=$?; failed=$((failed + 1)); printf 'rig: run %s %s failed rc=%s\n' "$v" "$(basename "$s")" "$rc" >&2; }
    done
  done
  # .done says the sweep FINISHED (every run was attempted), not that every run succeeded: the exit says that. D-3999: a failed run
  # left a bundle that builds `unmeasured` cells, and the sweep exited 0 over it, so a capture was trusted that had a hole in it.
  date -u +%Y-%m-%dT%H:%M:%SZ > "$RAW/.done"
  if (( failed )); then
    printf 'rig: %d of %d run(s) failed (the lines above name each); .done only marks the sweep as finished\n' "$failed" "$total" >&2
    return 1
  fi
}

case ${1-} in
  guard-root)     guard_root "${2-}" ;;
  guard-sock)     guard_sock "${2-}" ;;
  run-base)       run_base; echo ;;
  check-scenario) check_scenario "${2-}" || exit 2 ;;
  setup)          shift; cmd_setup "$@" ;;
  run)            shift; cmd_run "$@" ;;
  print-launch)   shift; cmd_print_launch "$@" ;;
  all)            shift; cmd_all "$@" ;;
  versions)       shift; pick_versions "$@"; if (( ${#VERS[@]} )); then printf '%s\n' "${VERS[@]}"; fi ;;
  reap)           cmd_reap ;;
  *)              sed -n '2,28p' "$0" >&2; exit 2 ;;
esac
