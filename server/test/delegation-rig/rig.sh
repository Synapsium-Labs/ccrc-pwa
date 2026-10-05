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
#   rig.sh all <raw-root>            reap, then every installed version x every scenario -> <raw-root>/<v>/<s>/,
#                                    then <raw-root>/.done
#   rig.sh reap                      remove what killed runs left: dlg<pid> tmux servers and
#                                    ccrc-dlg-rig.* roots whose owning rig.sh pid is gone
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TREE=$(cd "$HERE/../../.." && pwd)
REAL_HOME=$HOME
VERSIONS=$REAL_HOME/.local/share/claude/versions
SOCK_RE='^dlg[A-Za-z0-9_-]*$'
SESSION=cc-rig-hookcap
VERBS='waitReady type keys waitLabels probeLabels answerDialog sleep kill9 swapConfig relaunch snapshot'
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
  done < <(jq -c '.steps[]' "$f")
  k=$(jq -r '.settleS // 8 | tostring' "$f"); [[ $k =~ ^[0-9]{1,5}$ ]] || return 1
  return 0
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
  jq -n --arg tail "$(tail -c 20 "$R/key")" --arg repo "$R/repo" --arg v "$V" '{
      numStartups: 5, hasCompletedOnboarding: true, firstStartTime: "2026-01-01T00:00:00.000Z",
      lastOnboardingVersion: $v, lastReleaseNotesSeen: $v, lastClawdEntranceVersion: $v,
      fullscreenUpsellSeenCount: 3, officialMarketplaceAutoInstallAttempted: true,
      customApiKeyResponses: {approved: [$tail], rejected: []},
      projects: {($repo): {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true,
                           projectOnboardingSeenCount: 5, allowedTools: []}}}' > "$H/cfg/.claude.json"
}

# ── run ─────────────────────────────────────────────────────────────────────────────
VER="" SCEN="" RUN_R="" RUN_H="" SOCK="" CFG="" PORT="" MOCK_PID="" OUT_DIR="" COLLECTED=0
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
  local p dead c exe
  read -r dead p < <(T "$SOCK" display-message -p -t "$SESSION" '#{pane_dead} #{pane_pid}') || return 1
  [[ $dead == 0 && $p =~ ^[0-9]+$ ]] || return 1
  for c in "$p" $(pgrep -P "$p" 2>/dev/null); do
    exe=$(readlink "/proc/$c/exe" 2>/dev/null) || exe=""
    if [[ -z $exe && ! -d /proc ]]; then [[ $c != "$p" ]] && { printf '%s' "$c"; return 0; }; continue; fi
    [[ $exe == "$VERSIONS"/* ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
launch_cmd() {   # [claude args...] -> one shell command line for the pane (run by `bash -c`)
  local bin=$VERSIONS/$VER gen args="" a to=""
  [[ -x $bin ]] || die "no Claude Code binary '$VER' under $VERSIONS"
  gen=$(cat "$RUN_H/.cc-sessions/rig-hookcap.generation")
  for a in "$@"; do args+=" $(printf '%q' "$a")"; done
  if command -v timeout >/dev/null 2>&1; then to="timeout -k 10 $RUN_CAP_S "; elif command -v gtimeout >/dev/null 2>&1; then to="gtimeout -k 10 $RUN_CAP_S "; fi
  # TMUX/TMUX_PANE are expanded by the PANE's bash: inside this private server they name the
  # private socket, so the hook's own display-message asks the rig, never the default server.
  # The key is read from its 0600 file by that bash, so it never appears on a command line.
  printf 'cd %q && exec env -i PATH=%q TERM=tmux-256color LANG=C.UTF-8 LC_ALL=C.UTF-8 HOME=%q TMPDIR=%q CLAUDE_CONFIG_DIR=%q ANTHROPIC_API_KEY="$(cat %q)" ANTHROPIC_BASE_URL=http://127.0.0.1:%s DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_NO_FLICKER=0 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CCRC_SESSION_GENERATION=%q TMUX="$TMUX" TMUX_PANE="$TMUX_PANE" %s%q%s' \
    "$RUN_R/repo" "$(rig_path)" "$RUN_H" "$RUN_R/tmp" "$CFG" "$RUN_R/key" "$PORT" "$gen" "$to" "$bin" "$args"
}
snapshot() {   # <name>: the admin records and the .claude/worktrees entries, at this instant
  local d=$RUN_R/snapshots/$1
  mkdir -p "$d"
  { ls -A "$RUN_R/repo/.git/worktrees" 2>/dev/null || true; } > "$d/admin-records"
  { ls -A "$RUN_R/repo/.claude/worktrees" 2>/dev/null || true; } > "$d/worktrees"
}
run_steps() {
  local step verb sid pid
  while IFS= read -r step; do
    verb=$(jq -r 'keys_unsorted[0]' <<<"$step")
    case $verb in
      waitReady)    wait_ready "$(jq -r .waitReady <<<"$step")" || note "waitReady: no ready prompt" ;;
      type)         T "$SOCK" send-keys -t "$SESSION" -l -- "$(jq -r .type <<<"$step")" ;;
      keys)         mapfile -t ks < <(jq -r '.keys[]' <<<"$step"); T "$SOCK" send-keys -t "$SESSION" "${ks[@]}" ;;
      waitLabels)   wait_labels "$(jq -c .waitLabels <<<"$step")" "$(jq -r '.timeoutS // 120' <<<"$step")" \
                      || note "waitLabels $(jq -c .waitLabels <<<"$step"): timeout" ;;
      probeLabels)  wait_labels "$(jq -c .probeLabels <<<"$step")" "$(jq -r '.timeoutS // 120' <<<"$step")" \
                      || note "probe $(jq -c .probeLabels <<<"$step"): not reached" ;;
      answerDialog) if wait_text "$(jq -r .answerDialog <<<"$step")" "$(jq -r '.timeoutS // 10' <<<"$step")"; then
                      T "$SOCK" send-keys -t "$SESSION" Enter; note "dialog answered: $(jq -r .answerDialog <<<"$step")"
                    fi ;;
      sleep)        sleep "$(jq -r .sleep <<<"$step")" ;;
      kill9)        if pid=$(claude_pid); then kill -9 "$pid"; else note "kill9: no pid"; fi ;;
      swapConfig)   mkdir -p "$RUN_H/cfg2"; cp -a "$RUN_H/cfg/." "$RUN_H/cfg2/"; CFG=$RUN_H/cfg2 ;;
      relaunch)     if sid=$(current_sid) && [[ -n $sid ]]; then
                      T "$SOCK" respawn-pane -k -t "$SESSION" bash -c "$(launch_cmd --resume "$sid")"
                    else note "relaunch: no session id captured"; fi ;;
      snapshot)     snapshot "$(jq -r .snapshot <<<"$step")" ;;
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
}
cleanup_run() {
  if [[ $COLLECTED == 0 && -n $OUT_DIR && -n $RUN_R && -d $RUN_R ]]; then note "run aborted"; collect "$OUT_DIR" || true; fi
  if [[ -n $SOCK ]]; then T "$SOCK" kill-server 2>/dev/null || true; rm -f -- "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/$SOCK"; fi
  [[ -n $MOCK_PID ]] && kill "$MOCK_PID" 2>/dev/null || true
  if [[ -n $RUN_R ]] && guard_root "$RUN_R"; then
    # the pane's processes may still be dying and writing under the root: retry the removal
    for _ in 1 2 3 4 5 6; do rm -rf -- "$RUN_R" 2>/dev/null && break; sleep 2; done
    [[ ! -e $RUN_R ]] || printf 'rig: could not remove run root %s\n' "${RUN_R##*/}" >&2
  fi
}
cmd_run() {
  VER=${1-}; SCEN=${2-}; OUT_DIR=${3-}
  [[ -n $VER && -n $OUT_DIR ]] || die "usage: rig.sh run <version> <scenario.json> <out-dir>"
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
  MOCK_PORT=0 MOCK_SCRIPT=$SCEN MOCK_LOG=$RUN_R/mock.log node "$HERE/mockapi.mjs" > "$RUN_R/mock.out" 2>&1 &
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
    [[ -d $d && -f $d/.owner ]] || continue
    pid=$(cat "$d/.owner")
    [[ $pid =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null && continue
    d=$(cd -P -- "$d" && pwd) || continue
    guard_root "$d" && { rm -rf -- "$d"; printf 'rig: reaped run root %s\n' "${d##*/}" >&2; }
  done
  return 0
}
cmd_all() {
  local RAW=${1-} v s
  [[ -n $RAW ]] || die "usage: rig.sh all <raw-root>"
  guard_out "$RAW" || die "refusing raw-root '$RAW': it must not be inside the source tree"
  cmd_reap
  rm -f "$RAW/.done"
  for v in $(ls "$VERSIONS" | sort -t. -k1,1n -k2,2n -k3,3n); do
    [[ -x $VERSIONS/$v && $v =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
    for s in "$HERE"/scenarios/*.json; do
      bash "$0" run "$v" "$s" "$RAW/$v/$(basename "$s" .json)" \
        || printf 'rig: run %s %s failed rc=%s\n' "$v" "$(basename "$s")" "$?" >&2
    done
  done
  date -u +%Y-%m-%dT%H:%M:%SZ > "$RAW/.done"
}

case ${1-} in
  guard-root)     guard_root "${2-}" ;;
  guard-sock)     guard_sock "${2-}" ;;
  run-base)       run_base; echo ;;
  check-scenario) check_scenario "${2-}" || exit 2 ;;
  setup)          shift; cmd_setup "$@" ;;
  run)            shift; cmd_run "$@" ;;
  all)            shift; cmd_all "$@" ;;
  reap)           cmd_reap ;;
  *)              sed -n '2,22p' "$0" >&2; exit 2 ;;
esac
