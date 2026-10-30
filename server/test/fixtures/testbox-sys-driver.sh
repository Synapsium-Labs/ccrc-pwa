#!/usr/bin/env bash
# The fixture system for deploy/testbox/install.sh and deploy/testbox/bin/egress (D-7409; server/test/
# testbox-box-package.test.ts, server/test/testbox-config-file.test.ts): the TB_SYS seam's other end. Every call is
# logged as one tab-separated line to TBS_LOG, then answered without touching the system:
#   useradd, groupadd           recorded in TBS_DB (`passwd <name>`, `group <name>`), never run;
#   getent passwd|group <name>  answered from TBS_DB; getent ahostsv4|ahostsv6 <host> from TBS_HOSTS/<db>-<host>;
#   usermod, chown, chgrp, systemctl
#                               logged only (a test runs as a non-root user and has no system manager);
#   nft                         logged only; `nft -f -` appends its stdin to TBS_LOG.nft;
#   findmnt, xfs_info           TBS_FINDMNT's and TBS_XFS's text;
#   install                     run, with its -o and -g dropped (the log keeps them);
#   chmod                       run.
# Anything else exits 97, so a new system call is seen, never run.
set -u
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
  usermod|chown|chgrp|systemctl) exit 0 ;;
  nft) if [ "${1:-}" = -f ] && [ "${2:-}" = - ]; then cat >> "$TBS_LOG.nft"; fi; exit 0 ;;
  findmnt) cat -- "$TBS_FINDMNT" ;;
  xfs_info) cat -- "$TBS_XFS" ;;
  install) args=(); while (($#)); do case $1 in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done; exec install "${args[@]}" ;;
  chmod) exec chmod "$@" ;;
  *) printf 'fixture TB_SYS: no %s\n' "$cmd" >&2; exit 97 ;;
esac
