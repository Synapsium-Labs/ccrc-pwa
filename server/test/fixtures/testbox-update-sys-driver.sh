#!/usr/bin/env bash
# The fixture system for deploy/testbox/bin/box-update (D-8903; server/test/testbox-box-update.test.ts): the TB_SYS
# seam's other end. It answers the calls the updater makes beyond the installer's and hands every other call to
# testbox-sys-driver.sh, whose state file (TBS_DB) and log (TBS_LOG) it shares. Nothing here touches a system.
#   systemctl is-active <unit>      `active` (exit 0) when TBS_DB holds `active <unit>`, else `inactive` (exit 3);
#   systemctl stop <unit>...        the units' `active` lines removed; the test service's ready file removed;
#   systemctl show -P MainPID <u>   the pid of its last start (`mainpid <unit> <n>` in TBS_DB), or 0. For a release whose
#                                   tag TBS_EXITS lists, the service exits right after this answer (its `active` line
#                                   removed): a service that binds, writes its ready file and is gone a moment later;
#   systemctl list-units ...        TBS_BUSY's lines: the run, prepare and install units a test says are active;
#   systemctl start|restart|enable --now <...ccrc-testbox.service...>
#                                   the base driver's model first, then the test service itself: the release it runs is
#                                   the one <tools>/release/installed names. A tag listed in TBS_UNHEALTHY exits at once
#                                   (its `active` line removed). Otherwise it takes a new main pid and, when its tree
#                                   carries deploy/testbox/service-ready (the marker of a release whose service writes
#                                   the ready file), writes <root>/run/ccrc-testbox/ready;
#   nft list table inet ccrc_testbox           exit 0 when the table is loaded;
#   nft list set inet ccrc_testbox <set>       the set's cgroups, as nft prints them: one to a line, as nft wraps a long
#                                              set, so a reader that stops at its match closes the pipe on a writer;
# Two files a test may name make a call misbehave, each line a prefix of the call's words joined by spaces:
#   TBS_FAIL   a call that begins with one of its lines is logged and exits 1, and does nothing;
#   TBS_SLOW   `<seconds> <prefix>`: a call that begins with the prefix sleeps that long first.
set -u
HERE=$(cd "${BASH_SOURCE[0]%/*}" && pwd)
BASE=$HERE/testbox-sys-driver.sh
SVC=ccrc-testbox.service
TOOLS=$TB_FIXTURE_ROOT/opt/ccrc-testbox/tools
READY=$TB_FIXTURE_ROOT/run/ccrc-testbox/ready
log() { local line='' a; for a in "$@"; do line+="${line:+$'\t'}$a"; done; printf '%s\n' "$line" >> "$TBS_LOG"; }
has() { grep -qxF "$1" "$TBS_DB" 2>/dev/null; }
drop() { grep -vxF "$1" "$TBS_DB" > "$TBS_DB.tmp" || :; mv -- "$TBS_DB.tmp" "$TBS_DB"; }
listed() { [ -n "${1:-}" ] && grep -qxF "$2" "$1" 2>/dev/null; }
installed_tag() { local t; t=$(readlink "$TOOLS/release/installed" 2>/dev/null); printf '%s' "${t##*/}"; }
CALL="$*"
if [ -n "${TBS_FAIL:-}" ] && [ -f "$TBS_FAIL" ]; then
  while IFS= read -r p; do [ -n "$p" ] && [[ $CALL == "$p"* ]] && { log "$@"; exit 1; }; done < "$TBS_FAIL"
fi
if [ -n "${TBS_SLOW:-}" ] && [ -f "$TBS_SLOW" ]; then
  while read -r secs p; do [ -n "$p" ] && [[ $CALL == "$p"* ]] && sleep "$secs"; done < "$TBS_SLOW"
fi
service() {   # the test service after a start: up with a new pid and (a managed release) its ready file, or gone at once
  local tag pid
  has "active $SVC" || return 0
  tag=$(installed_tag)
  if listed "${TBS_UNHEALTHY:-}" "$tag"; then drop "active $SVC"; rm -f -- "$READY"; return 0; fi
  pid=$(sed -n "s/^mainpid $SVC //p" "$TBS_DB" | tail -n 1); pid=$(( ${pid:-4000} + 1 ))
  grep -v "^mainpid $SVC " "$TBS_DB" > "$TBS_DB.tmp" || :; mv -- "$TBS_DB.tmp" "$TBS_DB"
  printf 'mainpid %s %s\n' "$SVC" "$pid" >> "$TBS_DB"
  rm -f -- "$READY"
  if [ -f "$TOOLS/release/installed/deploy/testbox/service-ready" ]; then
    mkdir -p -- "${READY%/*}" && printf 'release\t%s\npid\t%s\n' "$tag" "$pid" > "$READY"
  fi
}
case "${1:-} ${2:-}" in
  'systemctl is-active') log "$@"; if has "active ${3:-}"; then echo active; exit 0; fi; echo inactive; exit 3 ;;
  'systemctl stop') log "$@"; shift 2; for u in "$@"; do drop "active $u"; [ "$u" = "$SVC" ] && rm -f -- "$READY"; done; exit 0 ;;
  'systemctl show')
    if [ "${3:-} ${4:-}" = '-P MainPID' ]; then log "$@"; p=$(sed -n "s/^mainpid ${5:-} //p" "$TBS_DB" | tail -n 1); has "active ${5:-}" && echo "${p:-0}" || echo 0
      if [ "${5:-}" = "$SVC" ] && listed "${TBS_EXITS:-}" "$(installed_tag)"; then drop "active $SVC"; fi
      exit 0; fi ;;
  'systemctl list-units') log "$@"; [ -n "${TBS_BUSY:-}" ] && [ -f "$TBS_BUSY" ] && cat -- "$TBS_BUSY"; exit 0 ;;
  'systemctl start'|'systemctl restart'|'systemctl enable')
    was=0; has "active $SVC" && was=1
    "$BASE" "$@" || exit $?
    names=0; for a in "$@"; do [ "$a" = "$SVC" ] && names=1; done
    [ "$names" = 1 ] || exit 0
    case $2 in
      restart) service ;;
      start) [ "$was" = 1 ] || service ;;
      enable) case " $* " in *' --now '*) [ "$was" = 1 ] || service ;; esac ;;
    esac
    exit 0 ;;
  'nft list')
    log "$@"
    if [ "${3:-}" = table ]; then has 'nft table'; exit $?; fi
    if [ "${3:-}" = set ]; then has 'nft table' || exit 1; printf 'table inet ccrc_testbox {\n\tset %s {\n\t\ttype cgroupsv2\n\t\telements = { ' "${6:-}"; sed -n "s/^nft ${6:-} \(.*\)$/\"\1\",/p" "$TBS_DB" | sed $'2,$s/^/\t\t\t     /'; printf '}\n\t}\n}\n'; exit 0; fi
    exit 0 ;;
esac
exec "$BASE" "$@"
