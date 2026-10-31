# ccd/lib/ccrc-settings.sh — GENERATED from ccd/ccrc by deploy/gen-settings-lib.mjs; never edit it by hand.
# ccrc's one reader of its settings (`_ccrc_knob`) and the byte-wise model it reads through, copied whole out of
# ccd/ccrc, so the ccd-* sweeps, which never source ccd/ccrc, read ~/.ccrc/ccrc.env exactly as ccrc does. The argument
# for every rule is in ccd/ccrc, above each function. server/test/ccrc-settings-lib.test.ts reds when the two differ.
# Installed 0644 at ~/.local/libexec/ccrc/ccrc-settings.sh: sourced, never executed, and sourcing it runs nothing.
BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"

CCRC_SETTINGS=(CCRC_BACKUP_KEEP CCRC_BACKUP_DATA_KEEP CCRC_VERSIONS_KEEP CCRC_UPDATE_HEALTH_S CCRC_UPDATE_DEADLINE_MS CCRC_RELEASE_BASE_URL CCRC_MODELS_ADVANCE_BUDGET_S CCRC_SESSION_SLICE_MEMORY_MAX CCRC_SESSION_SLICE_SWAP_MAX CCRC_TEST_SLICE_MEMORY_MAX CCRC_TEST_SLICE_SWAP_MAX CCRC_TEST_SLICE_CPU_WEIGHT CCRC_TEST_SLICE_CPU_QUOTA CCRC_TEST_SLICE_IO_WEIGHT CCRC_TEST_HEAVY_SLOTS CCRC_TEST_WIDE_FILES CCRC_TEST_PRESSURE_MAX CCRC_GRAPH_STORE CCRC_GRAPH_SOURCE_REF CCRC_GRAPH_REPOS_EXCLUDE CCRC_GRAPH_REFRESH_SECS CCRC_GRAPH_FETCH_SECS CCRC_GRAPH_FULL_REBUILD_SECS CCRC_GRAPH_INCREMENTAL_MAX_FILES CCRC_GRAPH_FULL_FAIL_MAX CCRC_GRAPH_FAIL_BACKOFF_SECS CCRC_GRAPH_BUDGET CCRC_GRAPH_BUILD_TIMEOUT CCRC_GRAPH_SLOT_WAIT_SECS CCRC_GRAPH_BUILD_NICE CCRC_GRAPH_MAX_WORKERS CCRC_GRAPH_MAX_SHRINK_PCT CCRC_GRAPH_KEEP_BUILDS CCRC_GRAPH_BUILD_GRACE_SECS CCRC_GRAPH_MIGRATE_BUDGET CCRC_GRAPH_HOOKSTATE_FRESH_SECS CCRC_GRAPH_GATE_MAX_DIFF_PCT CCRC_GRAPH_GATE_MAX_DENIALS CCRC_GRAPH_CARD_DIFF_LIST_MAX CCRC_KEEPALIVE_MODEL CCRC_KEEPALIVE_PROMPT CCRC_KEEPALIVE_FRESH CCRC_USAGE_SWEEP_DAYS CCRC_TESTBOX_URL CCRC_TESTBOX_TOKEN_FILE CCRC_TESTBOX_GIT_URL_BASE CCRC_TESTBOX_GIT_KEY CCRC_TESTBOX_UNTRACKED_FILE_MAX CCRC_TESTBOX_SNAPSHOT_MAX CCRC_TESTBOX_STATUS_DEADLINE CCRC_TESTBOX_RECONNECT_DEADLINE CCRC_TESTBOX_LOST_RUN CCRC_TESTBOX_QUEUE_LIMIT CCRC_TESTBOX_QUEUE_WAIT CCRC_TESTBOX_BUDGET CCRC_TESTBOX_DENY_GLOBS CCRC_TESTBOX_POLL CCRC_TESTBOX_FALLBACK_INSTALL CCRC_TESTBOX_TIMES CCRC_TESTBOX_RUNS CCRC_TESTBOX_WORKERS CCRC_TESTBOX_RUN_TMPDIR CCRC_TESTBOX_RUN_MEMORY_MAX CCRC_TESTBOX_RUN_SWAP_MAX CCRC_TESTBOX_RUN_CPU_QUOTA CCRC_TESTBOX_ROOT CCRC_TESTBOX_REPOS CCRC_TESTBOX_FETCH_EVERY CCRC_TESTBOX_RETENTION CCRC_TESTBOX_PRISTINE_KEEP CCRC_TESTBOX_PRISTINE_RETRY CCRC_TESTBOX_REPORT_MAX CCRC_TESTBOX_TOOLS_DIR CCRC_TESTBOX_OS_MIRROR CCRC_TESTBOX_EGRESS_ALLOW CCRC_TESTBOX_PUSH_USER CCRC_TESTBOX_ENV_FORWARD CCRC_TESTBOX_RUN_USER_PREFIX CCRC_TESTBOX_REGISTRY_PROXY CCRC_TESTBOX_REGISTRY_UPSTREAM CCRC_TESTBOX_TMPFS CCRC_TESTBOX_LOG_TAIL CCRC_TESTBOX_SESSION_RUNS CCRC_TESTBOX_SERVICE_USER CCRC_TESTBOX_LISTEN CCRC_TESTBOX_SERVICE_TOKEN_FILE CCRC_TESTBOX_UNIT_MAX)

_box_env_value() {   # <file> <key> [unit|shell]
  local file="$1" key="$2" mode="${3:-}" line v="" found=0 und=0 prevcont=0 qtaint=0 rest xk
  # Space, tab, CR — systemd's set, minus the newline `read` has consumed. A
  # variable rather than a literal bracket expression because a tab and a CR
  # typed inline are invisible in a diff and one stray edit from being deleted.
  local ws=$' \t\r'
  if [ "$mode" = unit ]; then _box_env_unit_whole "$file" || return 2; fi
  while IFS= read -r line || [ -n "$line" ]; do
    # `unit` mode only: a CR ends the line, as it does for systemd (wave 9 R10a).
    if [ "$mode" = unit ]; then line="${line%$'\r'}"; fi
    # Leading whitespace, exactly as systemd skips it — `_dr_trim`'s left half,
    # in the one namespace this file can reach, over systemd's character set
    # rather than POSIX's. `$ws` expands INSIDE the bracket expression, which
    # is why the pattern is unquoted here.
    line="${line#"${line%%[!$ws]*}"}"
    if [ "$mode" = unit ]; then
      # Wave 9 R10e (D-3823): shapes systemd may read and this reader cannot decide.
      case "$line" in
        "$key"[$' \t']*=*) und=1 ;;
        "$key="*) { [ "$prevcont" -eq 1 ] || [ "$qtaint" -eq 1 ]; } && und=1 ;;
        # `export`, one or more spaces or tabs, exactly KEY, optional spaces or tabs, `=` — D-3823's own text, "never a
        # longer key that begins with KEY" (fix round 1, F2): `export OLD_KEY=…` and `export NOTE=KEY=…` name another key.
        export[$' \t']*)
          xk="${line#export}"; xk="${xk#"${xk%%[!$' \t']*}"}"
          case "$xk" in
            "$key"*) xk="${xk#"$key"}"; xk="${xk#"${xk%%[!$' \t']*}"}"; case "$xk" in =*) und=1 ;; esac ;;
          esac ;;
      esac
      # A QUOTE THAT MAY SPAN LINES: systemd's '-quoted and "-quoted values can span lines, so a non-comment line
      # whose value carries a quote that is not ONE WHOLE PAIR on that line taints every later key line (never
      # cleared — conservative: it can only cost a "not measured").
      if _box_env_qopen "$line"; then qtaint=1; fi
      # systemd before v254 continued a comment line that ends in `\`, v254+ does not; this reader does not know which
      # version the box runs, so a key line after ANY line ending in `\` is not measured.
      case "$line" in *\\) prevcont=1 ;; *) prevcont=0 ;; esac
    elif [ "$mode" = shell ]; then
      # Wave 9 R10a, Darwin (round-2 ruling R-A): ONLY ever called on a file `_box_env_shell_plain` passed, so every
      # assignment line is `[export<ws>]NAME=<plain value>`. bash drops the export word and trailing spaces/tabs.
      case "$line" in export[$' \t']*) line="${line#export}"; line="${line#"${line%%[!$' \t']*}"}" ;; esac
      line="${line%"${line##*[!$' \t']}"}"
    fi
    case "$line" in
      "$key="*) v="${line#"$key="}"; found=1 ;;
      *) continue ;;
    esac
  done < "$file"
  # Trailing CR (a file edited on Windows) and surrounding quotes.
  v="${v%$'\r'}"
  if [ "$mode" = unit ] && [ "$found" -eq 1 ]; then
    # Wave 9 R10a (D-3822): whitespace (space, tab, CR) around an UNQUOTED value goes, as systemd
    # discards it (the run-182 ruling; systemd.exec(5)).
    v="${v#"${v%%[!$ws]*}"}"; v="${v%"${v##*[!$ws]}"}"
    case "$v" in
      *\\*) und=1 ;;                                   # an escape, quoted or not
      \"*\") rest="${v#?}"; case "${rest%?}" in *\"*) und=1 ;; esac ;;
      \'*\') rest="${v#?}"; case "${rest%?}" in *\'*) und=1 ;; esac ;;
      *\"*|*\'*) und=1 ;;                              # a quote that is not one whole pair ("on"x, on")
    esac
  fi
  if [ "$und" -eq 1 ]; then return 2; fi
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
  [ "$found" -eq 1 ]
}

_box_env_shell_plain() {   # <file>
  local file="$1" raw rest name val inner n=0
  BEP_LINE=0; BEP_CAUSE=""
  if _box_env_has_nul "$file"; then BEP_CAUSE=nul; return 1; fi
  while IFS= read -r raw || [ -n "$raw" ]; do
    n=$((n + 1))
    case "$raw" in *$'\r'*) BEP_LINE=$n; BEP_CAUSE=cr; return 1 ;; esac
    rest="${raw#"${raw%%[!$' \t']*}"}"
    case "$rest" in ''|'#'*) continue ;; esac
    rest="$raw"
    case "$rest" in export[$' \t']*) rest="${rest#export}"; rest="${rest#"${rest%%[!$' \t']*}"}" ;; esac
    case "$rest" in *=*) ;; *) BEP_LINE=$n; BEP_CAUSE=shape; return 1 ;; esac
    name="${rest%%=*}"
    case "$name" in ''|[0-9]*|*[!A-Za-z0-9_]*) BEP_LINE=$n; BEP_CAUSE=shape; return 1 ;; esac
    # Wave 11 R14(j) (D-3980, widened by D-3987): names /bin/bash reserves. Two ways the job's `set -a; . file` ends its
    # shell before the `exec`, so the job never starts, whatever CCRC_AUTH says. (1) Inside POSIX mode, which
    # POSIXLY_CORRECT turns on: assigning one of bash's read-only variables (five of this set in bash 3.2 — BASHOPTS
    # arrived in 4.1 — six in 5.2) or, in bash 3.2, BASH_ARGC, BASH_ARGV, BASH_LINENO, BASH_SOURCE, FUNCNAME or GROUPS.
    # (2) In every bash, with no POSIX mode: HISTCMD and OPTIND are integer variables with no assign function, so a value
    # that is an arithmetic error (`1/0`, `09`, `1+`) ends the shell (measured: bash 3.2.57, 4.4, 5.2.21). Refused as a
    # NAME whatever the value, in either file and in any order.
    case "$name" in
      POSIXLY_CORRECT|BASHOPTS|BASH_VERSINFO|EUID|PPID|SHELLOPTS|UID|BASH_ARGC|BASH_ARGV|BASH_LINENO|BASH_SOURCE|FUNCNAME|GROUPS|HISTCMD|OPTIND)
        BEP_LINE=$n; BEP_CAUSE=name; return 1 ;;
    esac
    val="${rest#*=}"; val="${val%"${val##*[!$' \t']}"}"
    case "$val" in *[!A-Za-z0-9_./:@%+,=-]*) ;; *) continue ;; esac
    case "$val" in
      \'*\') inner="${val:1:${#val}-2}"; case "$inner" in *\'*) ;; *) continue ;; esac ;;
      \"*\") inner="${val:1:${#val}-2}"; case "$inner" in *[\$\`\\\"]*) ;; *) continue ;; esac ;;
    esac
    BEP_LINE=$n; BEP_CAUSE=shape; return 1
  done < "$file"
  return 0
}

_box_env_has_nul() {   # <file>
  local chunk LC_ALL=C
  IFS= read -r -d '' chunk < "$1"
}

_box_env_qopen() {   # <line>
  local line="$1" rest ws=$' \t\r'
  case "$line" in
    ''|'#'*|';'*) return 1 ;;
    *\"*|*\'*) ;;
    *) return 1 ;;
  esac
  rest="${line#*=}"; rest="${rest#"${rest%%[!$ws]*}"}"; rest="${rest%"${rest##*[!$ws]}"}"
  case "$line" in *=*) ;; *) return 0 ;; esac
  case "$rest" in
    \"*\") case "${rest:1:${#rest}-2}" in *\"*|*\\*) return 0 ;; esac ;;
    \'*\') case "${rest:1:${#rest}-2}" in *\'*) return 0 ;; esac ;;
    *) return 0 ;;
  esac
  return 1
}

_box_env_unit_whole() {   # <file>
  local file="$1" line trimmed n=0 spans=0 cmtline=0
  local LC_ALL=C ws=$' \t\r'
  BEW_LINE=0; BEW_CAUSE=""
  if _box_env_has_nul "$file"; then BEW_CAUSE=nul; return 1; fi
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    case "$line" in *$'\r'*) BEW_LINE=$n; BEW_CAUSE=cr; return 1 ;; esac
    trimmed="${line#"${line%%[!$ws]*}"}"
    case "$trimmed" in
      '') continue ;;
      '#'*|';'*)
        # A comment: its high byte only matters if the file turns out to span values; remember the first.
        case "$trimmed" in *[!$'\001'-$'\177']*) [ "$cmtline" -ne 0 ] || cmtline=$n ;; esac
        continue ;;
    esac
    case "$trimmed" in *[!$'\001'-$'\177']*) BEW_LINE=$n; BEW_CAUSE=utf8; return 1 ;; esac
    case "$trimmed" in *\\) spans=1 ;; esac
    if _box_env_qopen "$trimmed"; then spans=1; fi
  done < "$file"
  if [ "$spans" -eq 1 ] && [ "$cmtline" -ne 0 ]; then BEW_LINE=$cmtline; BEW_CAUSE=utf8; return 1; fi
  return 0
}

_box_unit_env() {   # <KEY>
  local key="$1" v rc envund=0 expund=0 f envwhole="" envline=0 expwhole="" expline=0 whole wline
  BUE_VAL=""; BUE_SRC=""; BUE_NAMED=0; BUE_ENV=absent; BUE_EXP=absent; BUE_WHY=""; BUE_FIX=""
  if [ "${CCD_OS:-linux}" = darwin ]; then _box_unit_env_shell "$key"; return; fi
  # Wave 11 R14(f) (D-3979): the Linux arm reads BYTES, as systemd's EnvironmentFile= parser does. In the caller's
  # UTF-8 locale `unit` mode's `read` took a line ending in an incomplete UTF-8 sequence and the newline after it as one
  # character, so a comment swallowed the key line below it — a false ARMED or a false OFF. Declared HERE, after the
  # Darwin dispatch and never above it, in no spelling: a pin above it would cover `_box_unit_env_shell` too, and that
  # arm's own `LC_ALL=C` (D-3833) would stop being load-bearing — T4-M31 would no longer red (measured). U4p pins it.
  local LC_ALL=C
  if [ -e "$BOX_ENV_FILE" ]; then
    if [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ]; then
      BUE_ENV=ok
      v="$(_box_env_value "$BOX_ENV_FILE" "$key" unit)"; rc=$?
      case "$rc" in
        0) BUE_VAL="$v"; BUE_SRC="$BOX_ENV_FILE"; BUE_NAMED=1 ;;
        # Wave 9 R10a (D-3831): rc 2 is also what a file systemd would split or skip WHOLE answers, for any key; it is
        # told apart here (the read ran in a subshell), and is otherwise treated exactly as a per-key undecidable one.
        2) envund=1; _box_env_unit_whole "$BOX_ENV_FILE" || { envwhole="$BEW_CAUSE"; envline="$BEW_LINE"; } ;;
      esac
    else
      BUE_ENV=unreadable
    fi
  fi
  if [ -n "${CCRC_EXPOSURE_FILE:-}" ] && [ -e "$CCRC_EXPOSURE_FILE" ]; then
    if [ -f "$CCRC_EXPOSURE_FILE" ] && [ -r "$CCRC_EXPOSURE_FILE" ]; then
      BUE_EXP=readable
      v="$(_box_env_value "$CCRC_EXPOSURE_FILE" "$key" unit)"; rc=$?
      case "$rc" in
        0) BUE_VAL="$v"; BUE_SRC="$CCRC_EXPOSURE_FILE"; BUE_NAMED=1 ;;
        2) expund=1; _box_env_unit_whole "$CCRC_EXPOSURE_FILE" || { expwhole="$BEW_CAUSE"; expline="$BEW_LINE"; } ;;
      esac
    else
      BUE_EXP=unreadable
      return 2
    fi
  fi
  if [ "$expund" -eq 1 ] || { [ "$envund" -eq 1 ] && [ "$BUE_SRC" != "$CCRC_EXPOSURE_FILE" ]; }; then
    f="$BOX_ENV_FILE"; [ "$expund" -eq 1 ] && f="$CCRC_EXPOSURE_FILE"
    BUE_VAL=""; BUE_SRC=""; BUE_NAMED=0
    whole="$envwhole"; wline="$envline"
    if [ "$expund" -eq 1 ]; then whole="$expwhole"; wline="$expline"; fi
    case "$whole" in
      cr)   BUE_WHY="$f line $wline has a carriage return inside a line, and systemd ends a line at one, so what the unit receives from that file is not decided here"
            BUE_FIX="save $f with one line ending per line (LF, or CRLF) and no bare carriage return inside a line (ccrc expose rewrites the exposure file)" ;;
      nul)  BUE_WHY="$f holds a NUL byte, which systemd does not accept in an EnvironmentFile= (the unit's lines are optional, so it carries on without the file), so what the unit receives from that file is not decided here"
            BUE_FIX="remove the NUL byte from $f (ccrc expose rewrites the exposure file)" ;;
      utf8) BUE_WHY="$f line $wline has a non-ASCII byte in a NAME=value line (or in a comment-looking line a multi-line value may swallow), and systemd skips a file whose keys or values are not valid UTF-8, which this reader does not check, so what the unit receives from that file is not decided here"
            BUE_FIX="keep every NAME=value line of $f to ASCII (a non-ASCII host goes in as its punycode xn-- form; comments may stay unless a value above them spans lines (a line ending in a backslash, or a quote left open) — then fix that value or make the comment ASCII), then re-run (ccrc expose rewrites the exposure file)" ;;
      *)    BUE_WHY="$f names $key in a shape this reader does not decide (a space around '=', an export prefix, a backslash, a quote that is not one whole pair, a quote left open on an earlier line, or a line after one ending in a backslash)"
            BUE_FIX="rewrite the line naming $key in $f, or the line above it when that one ends in a backslash, as KEY=value: no space before or after '=', no export, no backslash, no quote except one whole pair around the value, and no quote left open on an earlier line (ccrc expose rewrites the exposure file)" ;;
    esac
    return 3
  fi
  return 0
}

_box_unit_env_shell() {   # <KEY>
  local key="$1" v rc bad="" LC_ALL=C
  if [ -e "$BOX_ENV_FILE" ]; then
    if [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ]; then
      BUE_ENV=ok
      if _box_env_shell_plain "$BOX_ENV_FILE"; then
        v="$(_box_env_value "$BOX_ENV_FILE" "$key" shell)"; rc=$?
        if [ "$rc" -eq 0 ]; then BUE_VAL="$v"; BUE_SRC="$BOX_ENV_FILE"; BUE_NAMED=1; fi
      else
        bad="$BOX_ENV_FILE"
      fi
    else
      BUE_ENV=unreadable
    fi
  fi
  if [ -n "${CCRC_EXPOSURE_FILE:-}" ] && [ -e "$CCRC_EXPOSURE_FILE" ]; then
    if [ -f "$CCRC_EXPOSURE_FILE" ] && [ -r "$CCRC_EXPOSURE_FILE" ]; then
      BUE_EXP=readable
      if [ -z "$bad" ]; then
        if _box_env_shell_plain "$CCRC_EXPOSURE_FILE"; then
          v="$(_box_env_value "$CCRC_EXPOSURE_FILE" "$key" shell)"; rc=$?
          if [ "$rc" -eq 0 ]; then BUE_VAL="$v"; BUE_SRC="$CCRC_EXPOSURE_FILE"; BUE_NAMED=1; fi
        else
          bad="$CCRC_EXPOSURE_FILE"
        fi
      fi
    else
      BUE_EXP=unreadable
      return 2
    fi
  fi
  [ -z "$bad" ] && return 0
  BUE_VAL=""; BUE_SRC=""; BUE_NAMED=0
  case "$BEP_CAUSE" in
    # D-3832: no line number — /bin/bash 3.2 drops everything after the first NUL in the FILE, so the cause is the file's.
    nul) BUE_WHY="$bad holds a NUL byte, and on macOS the launchd job sources both env files with /bin/bash, which stops reading a file at its first NUL byte, so what the job sets from that file is not decided here"
         BUE_FIX="remove the NUL byte from $bad (ccrc expose rewrites the exposure file)" ;;
    cr) BUE_WHY="$bad line $BEP_LINE carries a carriage return, which bash keeps in the value — on macOS the launchd job sources both env files with bash"
        BUE_FIX="save $bad without carriage returns (ccrc expose rewrites the exposure file)" ;;
    # D-3980: the cause and the line, never the variable (A1), and none of them called read-only (A5).
    name) BUE_WHY="$bad line $BEP_LINE assigns a variable /bin/bash reserves, and on macOS the launchd job sources both env files with /bin/bash, which can stop at such an assignment before the server starts (in POSIX mode, which one of them turns on, or, for two of them, a value that is not a number)"
          BUE_FIX="delete line $BEP_LINE of $bad, or rename the variable it sets (ccrc expose rewrites the exposure file)" ;;
    *)  BUE_WHY="$bad line $BEP_LINE is not a plain NAME=value line, and on macOS the launchd job sources both env files with bash, so that line can change what they set"
        BUE_FIX="rewrite line $BEP_LINE of $bad as NAME=value, with a value of letters, digits and _./:@%+,=- only, or one whole '…' pair, or one whole \"…\" pair with no \$, backtick, backslash or \" inside — or delete it (ccrc expose rewrites the exposure file)" ;;
  esac
  return 3
}

_ccrc_knob() {   # <KEY> <default> [file]
  local key="$1" f="$BOX_ENV_FILE" g=0 why=""
  KNOB=""; KNOB_FROM=""; KNOB_WHY=""
  case " ${CCRC_SETTINGS[*]} " in *" $key "*) ;; *) KNOB_WHY="$key is not one of ccrc's settings (CCRC_SETTINGS), so it is never read from a file"; return 1 ;; esac
  [ "${3:-}" = file ] || KNOB="${!key:-}"
  if [ -n "$KNOB" ]; then KNOB_FROM=environment
  elif [ -e "$f" ] || [ -L "$f" ]; then
    if [ -f "$f" ] && [ -r "$f" ]; then if _box_env_has_nul "$f" 2>/dev/null; then g=2; else LC_ALL=C awk -v k="$key" '{ sub(/^[ \t\r]+/, ""); t = $0; sub(/^export[ \t]+/, "", t); w = (" " $0 " ") ~ ("[^A-Za-z0-9_]" k "[^A-Za-z0-9_]"); n += w && (!/^[#;]/ || /\r./) } !/\r./ && (/^[#;]/ || index($0, k "=") == 1 || (t ~ /^[A-Za-z_][A-Za-z0-9_]*=/ && index(t, k "=") != 1)) { next } w { f = 1; exit } END { exit (f ? 0 : (n ? 1 : 4)) }' "$f" 2>/dev/null || g=$?; fi; else g=3; fi
    case "$g" in 0) why="$f names it on a line this reader does not take (it reads only a plain KEY=value line)" ;; 1|4) ;; 3) why="$f is there but cannot be read" ;; *) why="$f could not be scanned" ;; esac
    # The named file alone: a path that cannot exist stands in for the exposure file, which no process that acts on any other
    # setting receives (review 839; the deadline's `min` and `max` name it as the file instead, D-6602). Never the empty
    # spelling, `CCRC_EXPOSURE_FILE=`: the model's own refusal of an undecidable ccrc.env compares its source with that path.
    if [ "$g" = 1 ] || { [ "$g" = 4 ] && [ "${CCD_OS:-linux}" = darwin ] && [ "$key" = CCRC_BACKUP_DATA_KEEP ]; }; then CCRC_EXPOSURE_FILE="$f/." _box_unit_env "$key" 2>/dev/null; case $? in 0) KNOB="$BUE_VAL"; if [ -n "$KNOB" ]; then KNOB_FROM=file; elif [ "$BUE_NAMED" = 1 ]; then KNOB_FROM=empty; fi ;; *) why="${BUE_WHY:-$f could not be scanned}" ;; esac; fi
    [ -z "$why" ] || { KNOB=""; KNOB_WHY="$key cannot be measured: ${why/#"$HOME"/\~}"; return 1; }
  fi
  [ -n "$KNOB" ] || { KNOB="$2"; KNOB_FROM="${KNOB_FROM:-default}"; }
}
