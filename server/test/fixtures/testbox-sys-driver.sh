#!/usr/bin/env bash
# The fixture system for deploy/testbox/install.sh, deploy/testbox/bin/egress and bin/firewall (D-7409; server/test/
# testbox-box-package.test.ts, server/test/testbox-config-file.test.ts): the TB_SYS seam's other end. Every call is
# logged as one tab-separated line to TBS_LOG, then answered without touching the system:
#   useradd, groupadd           recorded in TBS_DB (`passwd <name>`, `group <name>`), never run;
#   getent passwd|group <name>  answered from TBS_DB; getent ahostsv4|ahostsv6 <host> from TBS_HOSTS/<db>-<host>;
#   usermod, chown, chgrp       logged only (a test runs as a non-root user);
#   systemctl                   a model system manager when TB_FIXTURE_ROOT is set, logged only otherwise: the units
#                               active are `active <unit>` lines in TBS_DB; a start of a unit whose file or drop-in
#                               says Requires=nftables.service starts nftables.service first; nftables.service's
#                               start and reload run the distribution's `flush ruleset` (logged as
#                               `[nftables.service] flush ruleset`), then its drop-in's ExecStartPost= or
#                               ExecReload= lines; its restart restarts the units that require it; a start adds the
#                               unit's NFTSet= cgroup to its set; `show -P ControlGroup <unit>` is
#                               /system.slice/<unit> for an active unit, empty otherwise;
#   nft                         logged; the firewall's state is `nft table` and `nft <set> <cgroup>` lines in TBS_DB:
#                               `nft -f <file>` loads the table and keeps its sets, `nft add element inet ccrc_testbox
#                               <set> { "<cgroup>" }` adds a cgroup (exit 1 with no table); `nft -f -` appends its
#                               stdin to TBS_LOG.nft;
#   findmnt, xfs_info           TBS_FINDMNT's and TBS_XFS's text;
#   install                     run, with its -o and -g dropped (the log keeps them);
#   chmod                       run.
# Anything else exits 97, so a new system call is seen, never run.
set -u
SELF=${BASH_SOURCE[0]}
UNITS=${TB_FIXTURE_ROOT:+$TB_FIXTURE_ROOT/etc/systemd/system}
db_has() { grep -qxF "$1" "$TBS_DB" 2>/dev/null; }
db_add() { db_has "$1" || printf '%s\n' "$1" >> "$TBS_DB"; }
props() { cat -- "$UNITS/$1" "$UNITS/$1.d/"*.conf 2>/dev/null; }
nftset_add() {   # <unit>: its NFTSet= cgroup into its set, as systemd does at the unit's start
  local s
  while IFS= read -r s; do db_has 'nft table' && db_add "nft $s system.slice/$1"; done < <(props "$1" | sed -n 's/^NFTSet=cgroup:inet:ccrc_testbox://p')
}
post() {   # <key>: nftables.service's drop-in's <key>= lines, each run as the system manager would
  local l argv
  while IFS= read -r l; do
    read -ra argv <<< "$l"
    case ${argv[0]##*/} in
      nft|systemctl) "$SELF" "${argv[0]##*/}" "${argv[@]:1}" || return 1 ;;
      *) TB_SYS=$SELF "${argv[@]}" || return 1 ;;
    esac
  done < <(sed -n "s/^$1=//p" "$UNITS/nftables.service.d/50-ccrc-testbox.conf" 2>/dev/null)
}
dist() {   # the distribution's nftables.service start or reload: /etc/nftables.conf, which begins with `flush ruleset`
  printf '[nftables.service] flush ruleset\n' >> "$TBS_LOG"
  if [ -f "$TBS_DB" ]; then grep -v '^nft ' "$TBS_DB" > "$TBS_DB.tmp"; mv -- "$TBS_DB.tmp" "$TBS_DB"; fi
}
start_unit() {   # <unit>
  db_has "active $1" && return 0
  if props "$1" | grep -qx 'Requires=nftables.service'; then start_unit nftables.service || return 1; fi
  db_add "active $1"
  if [ "$1" = nftables.service ]; then dist; post ExecStartPost || return 1; fi
  nftset_add "$1"
}
restart_unit() {   # <unit>
  if [ "$1" != nftables.service ]; then db_has "active $1" || { start_unit "$1"; return; }; nftset_add "$1"; return 0; fi
  db_add 'active nftables.service'
  dist; post ExecStartPost || return 1
  local u act=()
  while IFS= read -r u; do act+=("$u"); done < <(sed -n 's/^active //p' "$TBS_DB")
  for u in ${act[@]+"${act[@]}"}; do if props "$u" | grep -qx 'Requires=nftables.service'; then nftset_add "$u"; fi; done
  return 0
}
manager() {   # systemctl's arguments
  local verb=$1 now=0 u
  shift
  local units=()
  for a in "$@"; do case $a in --now) now=1 ;; --*) ;; *) units+=("$a") ;; esac; done
  case $verb in
    show) [ "${1:-}" = -P ] && [ "${2:-}" = ControlGroup ] || return 0; db_has "active ${3:-}" && printf '/system.slice/%s\n' "$3"; return 0 ;;
    start) for u in ${units[@]+"${units[@]}"}; do start_unit "$u" || return 1; done ;;
    enable) [ "$now" = 0 ] || for u in ${units[@]+"${units[@]}"}; do start_unit "$u" || return 1; done ;;
    restart) for u in ${units[@]+"${units[@]}"}; do restart_unit "$u" || return 1; done ;;
    reload) for u in ${units[@]+"${units[@]}"}; do
              [ "$u" = nftables.service ] || continue
              db_has 'active nftables.service' || return 1
              dist; post ExecReload || return 1
            done ;;
  esac
  return 0
}
line=''
for a in "$@"; do line+="${line:+$'\t'}$a"; done
printf '%s\n' "$line" >> "$TBS_LOG"
cmd=${1:-}
shift || true
case $cmd in
  useradd) n=''; ug=0; for a in "$@"; do n=$a; [ "$a" = --user-group ] && ug=1; done
           printf 'passwd %s\n' "$n" >> "$TBS_DB"; [ "$ug" = 0 ] || printf 'group %s\n' "$n" >> "$TBS_DB"; exit 0 ;;
  groupadd) n=''; for a in "$@"; do n=$a; done; printf 'group %s\n' "$n" >> "$TBS_DB"; exit 0 ;;
  getent)
    case ${1:-} in
      passwd|group) grep -qxF "$1 ${2:-}" "$TBS_DB" 2>/dev/null && { printf '%s:x:999:999::/nonexistent:/usr/sbin/nologin\n' "$2"; exit 0; }; exit 2 ;;
      ahostsv4|ahostsv6) f="$TBS_HOSTS/$1-${2:-}"; [ -f "$f" ] && { cat -- "$f"; exit 0; }; exit 2 ;;
    esac
    exit 2 ;;
  usermod|chown|chgrp) exit 0 ;;
  systemctl) [ -n "$UNITS" ] && [ -d "$UNITS" ] || exit 0; manager "$@"; exit ;;
  nft)
    if [ "${1:-}" = -f ] && [ "${2:-}" = - ]; then cat >> "$TBS_LOG.nft"; exit 0; fi
    if [ "${1:-}" = -f ]; then db_add 'nft table'; exit 0; fi
    if [ "${1:-} ${2:-} ${3:-} ${4:-}" = 'add element inet ccrc_testbox' ] && [ "$#" -eq 6 ]; then
      db_has 'nft table' || { printf 'Error: No such file or directory\n' >&2; exit 1; }
      cg=${6#\{ \"}; cg=${cg%\" \}}; db_add "nft $5 $cg"; exit 0
    fi
    exit 0 ;;
  findmnt) cat -- "$TBS_FINDMNT" ;;
  xfs_info) cat -- "$TBS_XFS" ;;
  install) args=(); while (($#)); do case $1 in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done; exec install "${args[@]}" ;;
  chmod) exec chmod "$@" ;;
  *) printf 'fixture TB_SYS: no %s\n' "$cmd" >&2; exit 97 ;;
esac
