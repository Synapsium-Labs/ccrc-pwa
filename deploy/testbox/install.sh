#!/usr/bin/env bash
# The test box's installer (D-7409, D-7423, D-7424, D-7451, D-7456, D-7568; plan
# docs/superpowers/plans/2026-10-29-test-box.md, Task TB7; spec §2.0, §2.2, §2.3, §9). Root, idempotent, run from the
# extracted release tree it ships in:
#
#   bash <staging>/deploy/testbox/install.sh --release <tag> --node <version> --repos <row file> [--repos <row file>]... \
#        --distro <ID>-<VERSION_ID> --push-key <public key file>
#   bash <tools>/release/installed/deploy/testbox/install.sh --reapply [--repos <row file>]...
#   bash <tools>/release/installed/deploy/testbox/install.sh --unpair
#
# A row file is one repository row (shared/testbox.ts#parseRepoRow's JSON), named `<name>.json` for its row's name; it
# is installed as `CCRC_TESTBOX_REPOS/<name>.json`, the table the service and the push user's forced command read.
#
# It installs the test service and nothing of ccrc's own: it never runs `ccrc install`, the repository's install.sh or
# any user unit, so the box gets no ccrc server, no agent and no user manager units (D-7424). Every path and name comes
# from the box's one config file through `_testbox_knobs box`'s table (`_tb_load box`), whose path `_tb_box_env_file`
# gives (D-7451); it reads no home ccrc.env and no test box setting from its environment (each is unset first: they hold
# for the whole box, so only the box file sets them). `--distro` and `--push-key` name the two inputs the plan's
# invocation has no source for: the distribution release the box must run (D-7423) and the fleet host's push key, the
# one `authorized_keys` entry of the push user (spec §2.1) (D-7568).
#
# The phases, in order; the refusals come before anything is written:
#   1. refusals: the box file passes `_tb_box_file_ok` (its expected owner is `_tb_box_owner_uid`'s, D-7456) and every
#      value is valid (`_tb_load box` with no warning); the staging MANIFEST passes `sha256sum -c`; build.json's
#      version is --release; --node is a version; an installed release naming another tag refuses (later releases come
#      only through the tool sync); CCRC_TESTBOX_ROOT, _REPOS and _TOOLS_DIR are absolute (the root installer has no
#      reader's home to resolve `~/` against, D-7568); the listen address and the registry proxy are IP literals (the
#      firewall and IPAddressAllow= take addresses); CCRC_TESTBOX_ROOT, _REPOS, _TOOLS_DIR and each mirrorPath's parent are
#      below /srv, /mnt, /media, /opt, /data, /etc/ccrc-testbox or /var/lib/ccrc-testbox, never a system directory; the
#      service token is the service user's (`~/` or /var/lib/<service user>/); no user is root, named twice or a run user's, and a user
#      that exists is one this installer made (its account comment is `ccrc test box`, D-8166); every egress name is a
#      row of spec §2.0's table; the row file and the push key read; CCRC_TESTBOX_ROOT's filesystem is XFS with reflink=1; the distribution release is --distro's.
#   2. the first release: <staging> copied to <tools>/release/<tag>, root's, no group or other write, and
#      <tools>/release/installed linked to it in one rename; refused when any path of that tree is then not root's or is
#      writable by group or other.
#   3. the verifier's node: TB6's `_tbt_node_install` (the one function the tool sync calls too), then the bootstrap
#      set <tools>/sets/s.bootstrap holding the one link `node`, and <tools>/current naming it in one rename.
#   4. the release's dependencies: `npm ci --omit=dev --ignore-scripts` in <tools>/release/<tag>/server (the verifier's)
#      and <tools>/release/<tag>/agent (the test service's: agent/src/testbox/main.ts imports ws, and a bare import in
#      agent/dist resolves from agent/node_modules) under that node, straight from CCRC_TESTBOX_REGISTRY_UPSTREAM (the
#      firewall is not loaded yet). --ignore-scripts leaves node-pty unbuilt; the test service never imports it.
#   5. the users and groups, the box file's group and mode (the service user's, 0640), CCRC_TESTBOX_ROOT's
#      directories, the repository rows and their mirrors, the units with their drop-ins (the box's own tailnet client,
#      resolver and time client among them: each adds its cgroup to the firewall's set when it starts; nftables.service's
#      runs the load step after its start and its reload), the load step, the polkit rule, the firewall file and the
#      egress names, each name once.
#   6. last: nftables.service enabled and started (its start may flush the ruleset, then runs the load step), then the
#      load step (deploy/testbox/bin/firewall, installed in phase 5 as /usr/local/sbin/ccrc-testbox-firewall: the
#      file, the running tailnet client's, resolver's and time client's cgroups added to its sets, the address sets
#      asked for), then the service and the egress timer enabled and started, and the installed marker
#      (<etc>/installed: the tag and the box file's sha256) written.
# A re-run with the installed marker present changes nothing when the box file's sha256 and the tag are the marker's and the
# push user holds the key named by --push-key; otherwise it runs phase 5 again, reloads the firewall and the system manager, restarts the service, refreshes the
# egress sets and records the new tag and sha256.
#
# Two more modes run from the installed tree (<tools>/release/installed) and from nowhere else (D-8166):
#   --reapply  applies a changed box file, or new repository rows (--repos), at the installed tag: phase 1's value
#              refusals, then phases 5 and 6 (phases 2 to 4 are the first install's and are skipped). The tag is the
#              tree's build.json version; the installed marker may name an older tag (tool sync switches the installed
#              tree and never rewrites the marker: apply-release), and the marker then records the tree's tag. The
#              repository rows are the installed ones unless --repos names others; the push user's key is the one
#              installed. With the tag, the box file and the rows unchanged it changes nothing, unless --force: that
#              runs phases 5 and 6 anyway (repair rewrites units, drop-ins, rule, firewall file and key, and restarts).
#   --unpair   stops and disables the test service and the egress timer, empties the push user's authorized_keys and
#              removes the service token file. It leaves CCRC_TESTBOX_ROOT, the mirrors and the installed tree (the box
#              is rebuilt, never reused: no wipe) and the installed marker.
#
# Every system call goes through one seam, TB_SYS (empty on a box: the command runs as it is), so the tests run this
# into a fixture root as a non-root user. The files a system reads (units, drop-ins, the rule, the firewall file) are
# written under the box file's own root, the part of `_tb_box_env_file` before its /etc/, which is / on a box.
set -uo pipefail
umask 022

TBI_PROG=ccrc-testbox-install
TBI_RE_TAG='^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
TBI_RE_NODE='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'

refuse() { printf '%s: refused: %s; nothing was written\n' "$TBI_PROG" "$*" >&2; exit 1; }
fail() { printf '%s: failed: %s\n' "$TBI_PROG" "$*" >&2; exit 1; }
say() { printf '%s: %s\n' "$TBI_PROG" "$*" >&2; }
_tbi_sha256() { local l; l=$(_plat_sha256 "$1") || return 1; printf '%s\n' "${l%% *}"; }   # ccd/ccrc's wrapper

dir() { _sys install -d -m "$1" -o "$2" -g "$3" "$4" || fail "cannot make $4"; }
put() { _sys install -m "$1" -o root -g root "$2" "$3" || fail "cannot write $3"; }

# ── the arguments ────────────────────────────────────────────────────────
usage() {
  printf 'usage: install.sh --release <tag> --node <version> --repos <row file>... --distro <ID>-<VERSION_ID> --push-key <file>\n' >&2
  printf '       <tools>/release/installed/deploy/testbox/install.sh --reapply [--force] [--repos <row file>]...\n' >&2
  printf '       <tools>/release/installed/deploy/testbox/install.sh --unpair\n' >&2
  exit 2
}
MODE=install
FORCE=0
A_REL='' A_NODE='' A_DISTRO='' A_KEY=''
A_REPOS=()
while (($#)); do
  case $1 in
    --reapply) [ "$MODE" = install ] || usage; MODE=reapply; shift ;;
    --force) FORCE=1; shift ;;
    --unpair) [ "$MODE" = install ] || usage; MODE=unpair; shift ;;
    --release) (($# >= 2)) || usage; A_REL=$2; shift 2 ;;
    --node) (($# >= 2)) || usage; A_NODE=$2; shift 2 ;;
    --repos) (($# >= 2)) || usage; A_REPOS+=("$2"); shift 2 ;;
    --distro) (($# >= 2)) || usage; A_DISTRO=$2; shift 2 ;;
    --push-key) (($# >= 2)) || usage; A_KEY=$2; shift 2 ;;
    *) usage ;;
  esac
done
case $MODE in
  install) [ -n "$A_REL" ] && [ -n "$A_NODE" ] && [ "${#A_REPOS[@]}" -gt 0 ] && [ -n "$A_DISTRO" ] && [ -n "$A_KEY" ] || usage ;;
  reapply) [ -z "$A_REL$A_NODE$A_DISTRO$A_KEY" ] || usage ;;
  unpair) [ -z "$A_REL$A_NODE$A_DISTRO$A_KEY" ] && [ "${#A_REPOS[@]}" -eq 0 ] || usage ;;
esac
[ "$FORCE" = 0 ] || [ "$MODE" = reapply ] || usage

TBI_HERE=${BASH_SOURCE[0]}
[[ $TBI_HERE == */* ]] || TBI_HERE=./$TBI_HERE
TBI_HERE=$(cd "${TBI_HERE%/*}" && pwd) || refuse "cannot find the installer's directory"
STAGING=${TBI_HERE%/deploy/testbox}
[ "$STAGING" != "$TBI_HERE" ] || refuse "not run from a release tree's deploy/testbox: $TBI_HERE"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-testbox-install.XXXXXX") || fail "no temporary directory"
trap 'rm -rf -- "$WORK"' EXIT

# ── phase 1: the refusals ────────────────────────────────────────────────
while IFS= read -r v; do case $v in CCRC_TESTBOX_*) unset "$v" ;; esac; done < <(compgen -e)
# shellcheck source=/dev/null  # the staging tree's own ccd/testbox-knobs
. "$STAGING/ccd/testbox-knobs" || refuse "cannot load $STAGING/ccd/testbox-knobs"
# shellcheck source=/dev/null  # the staging tree's own install steps (deploy/testbox/box-steps): the functions named tbs_*
. "$STAGING/deploy/testbox/box-steps" || refuse "cannot load $STAGING/deploy/testbox/box-steps"
BOXFILE=$(_tb_box_env_file)
SYSROOT=${BOXFILE%/etc/*}
ETC=${BOXFILE%/*}
_tb_box_file_ok "$BOXFILE" || refuse "the box file: $TB_BOX_WHY"
PROG=$TBI_PROG _tb_load box || refuse "the box file's settings cannot be read"
if [ "${#TBK_WARN[@]}" -gt 0 ]; then
  for w in "${TBK_WARN[@]}"; do printf '%s\n' "$w" >&2; done
  refuse "the box file holds a value that is not its setting's shape (above)"
fi

if [ "$MODE" != unpair ]; then
tbs_manifest "$STAGING"
[ "$MODE" = reapply ] || [[ $A_REL =~ $TBI_RE_TAG ]] || refuse "--release $A_REL is not a release tag"
bj=$(cat -- "$STAGING/build.json" 2>/dev/null) || refuse "the staging tree has no build.json"
[[ $bj =~ \"version\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] || refuse "build.json names no version"
if [ "$MODE" = reapply ]; then
  A_REL=${BASH_REMATCH[1]}   # the installed tree's own tag
  [[ $A_REL =~ $TBI_RE_TAG ]] || refuse "build.json's version $A_REL is not a release tag"
else
  [ "${BASH_REMATCH[1]}" = "$A_REL" ] || refuse "build.json's version ${BASH_REMATCH[1]} is not --release $A_REL"
  [[ $A_NODE =~ $TBI_RE_NODE ]] || refuse "--node $A_NODE is not a version"
fi

fi

tbs_box_paths

# --reapply and --unpair run from the installed tree and from nowhere else: a copy would be applied from a tree the
# units do not name, and the first install's tree copy would land on itself.
if [ "$MODE" != install ]; then
  here=$(cd -- "$STAGING" 2>/dev/null && pwd -P) || here=''
  there=$(cd -- "$TREE" 2>/dev/null && pwd -P) || there=''
  [ -n "$there" ] && [ "$here" = "$there" ] || refuse "--$MODE runs only from the installed tree $TREE, not $STAGING"
fi
if [ "$MODE" = unpair ]; then
  say "unpairing: the service, the egress timer, the push key and the service token"
  _sys systemctl disable --now ccrc-testbox.service ccrc-testbox-egress.timer || fail "cannot stop and disable the test service"
  : > "$WORK/empty"
  dir 0755 root root "$SYSROOT/var/lib/$PUSH/.ssh"
  put 0644 "$WORK/empty" "$SYSROOT/var/lib/$PUSH/.ssh/authorized_keys"
  # The service reads its token from a path of the service user's home when the setting is `~/`-relative.
  tbs_token_path; tok=$TOKEN
  [ -n "$tok" ] || fail "CCRC_TESTBOX_SERVICE_TOKEN_FILE is empty"
  rm -f -- "$tok" || fail "cannot remove $tok"
  say "unpaired; the run root, the mirrors and the installed release are left as they are"
  exit 0
fi

inst=$(readlink -- "$TOOLS/release/installed" 2>/dev/null) || inst=''
[ -z "$inst" ] || [ "${inst##*/}" = "$A_REL" ] || refuse "$TOOLS/release/installed names ${inst##*/}, not $A_REL: later releases come only through the tool sync"

tbs_addresses
tbs_egress_names
tbs_rows
tbs_push_key

tbs_users_ok

tbs_run_root_fs
tbs_os_release
# shellcheck disable=SC2154  # os_id and os_ver are set by box-steps' tbs_os_release
[ "$MODE" = reapply ] || [ "$os_id-$os_ver" = "$A_DISTRO" ] || refuse "the box runs ${os_id:-?}-${os_ver:-?}, not --distro $A_DISTRO"

BOX_SHA=$(_tbi_sha256 "$BOXFILE") || refuse "cannot hash $BOXFILE"
MARK_TAG='' MARK_SHA=''
if [ -f "$ETC/installed" ]; then
  while IFS=$'\t' read -r a b; do case $a in release) MARK_TAG=$b ;; box-sha256) MARK_SHA=$b ;; esac; done < "$ETC/installed"
fi
same_rows=1
if [ "$MODE" = reapply ]; then
  # Tool sync switches the installed link to a new tag and never rewrites the marker, so after a sync the marker may
  # name an older tag than the tree: that is the apply-release case, and phases 5 and 6 below record the tree's tag
  # (D-8166). Only a box with no marker (never installed) is refused.
  [ -n "$MARK_TAG" ] || refuse "the box has no installed marker (run the first install, not --reapply)"
  for i in "${!ROW_NAMES[@]}"; do
    [ "${ROW_FILES[$i]}" -ef "$REPOS/${ROW_NAMES[$i]}.json" ] || cmp -s -- "${ROW_FILES[$i]}" "$REPOS/${ROW_NAMES[$i]}.json" || same_rows=0
  done
fi
# A first-install run is also asked to install a key: with the marker, the tag and the box file all the same, the box is current only
# when the key it holds IS that key. An unpaired box keeps its marker (--unpair never removes it) and holds no key, so a re-pair with
# the same tag and a byte-identical box file would otherwise read "nothing to do" and leave the new key out (every push refused) and the
# service and the egress timer disabled.
same_key=1
if [ "$MODE" = install ]; then
  inst_line=$(head -n 1 -- "$SYSROOT/var/lib/$PUSH/.ssh/authorized_keys" 2>/dev/null) || inst_line=''
  [[ $inst_line =~ ^restrict,command=\"[^\"]*\"[[:space:]]+(ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ssh-rsa)[[:space:]]+([A-Za-z0-9+/]+=*)([[:space:]].*)?$ ]] \
    && [ "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}" = "$PUSH_KEY" ] || same_key=0
fi
if [ "$FORCE" = 0 ] && [ -n "$MARK_TAG" ] && [ "$MARK_TAG" = "$A_REL" ] && [ "$MARK_SHA" = "$BOX_SHA" ] && [ "$same_rows" = 1 ] && [ "$same_key" = 1 ]; then
  say "$A_REL is installed and the box file is unchanged; nothing to do"
  exit 0
fi

# ── phase 2: the first release (D-7424) ──────────────────────────────────
if [ -z "$MARK_TAG" ]; then
  say "phase 2: the release $A_REL"
  dir 0755 root root "$TOOLS"
  dir 0755 root root "$TOOLS/release"
  dst=$TOOLS/release/$A_REL
  if [ ! -d "$dst" ]; then
    st=$TOOLS/release/.stage.$A_REL
    tbs_tree_copy "$STAGING" "$st"
    tbs_tree_place "$st" "$dst"
  fi
  tbs_tree_owned "$dst"
  if [ -z "$inst" ]; then
    rm -f -- "$TOOLS/release/.installed.new"
    ln -s "$A_REL" "$TOOLS/release/.installed.new" || fail "cannot link $TOOLS/release/installed"
    mv -- "$TOOLS/release/.installed.new" "$TOOLS/release/installed" || fail "cannot link $TOOLS/release/installed"
  fi

  # ── phase 3: the verifier's node (D-7424, D-7425) ──────────────────────
  say "phase 3: node $A_NODE"
  # shellcheck source=/dev/null  # the installed tree's own tools-sync, for TB6's node install function
  . "$TREE/deploy/testbox/bin/tools-sync" || fail "cannot load the installed tools-sync"
  dir 0755 root root "$TOOLS/node"
  _tbt_node_install "$TOOLS" "$A_NODE" "$(k CCRC_TESTBOX_REGISTRY_PROXY)" || fail "node: $TBT_WHY"
  if [ ! -L "$TOOLS/current" ]; then
    dir 0755 root root "$TOOLS/sets"
    dir 0755 root root "$TOOLS/sets/s.bootstrap"
    ln -sfn "../../node/$A_NODE/bin/node" "$TOOLS/sets/s.bootstrap/node" || fail "cannot link the bootstrap set's node"
    rm -f -- "$TOOLS/.current.new"
    ln -s sets/s.bootstrap "$TOOLS/.current.new" || fail "cannot link $TOOLS/current"
    mv -- "$TOOLS/.current.new" "$TOOLS/current" || fail "cannot link $TOOLS/current"
  fi

  # ── phase 4: the release's dependencies (the verifier's and the test service's) ──
  say "phase 4: the release's server/ and agent/ production dependencies"
  tbs_tree_deps "$dst" "$TOOLS/node/$A_NODE/bin" "$(k CCRC_TESTBOX_REGISTRY_UPSTREAM)"
fi

# ── phase 5: users, directories, rows, mirrors, units, rule, firewall file ─
say "phase 5: users, directories, units, the rule and the firewall file"
tbs_users
tbs_run_root_dirs
tbs_push_key_install
tbs_rows_install
tbs_units
tbs_rule_firewall

# ── phase 6: the firewall, the service, the marker ───────────────────────
say "phase 6: the firewall, the service and the marker"
_sys systemctl daemon-reload || fail "systemctl daemon-reload failed"
tbs_firewall_load
if [ -z "$MARK_TAG" ]; then tbs_service_start first; else tbs_service_start again; fi
printf 'release\t%s\nbox-sha256\t%s\n' "$A_REL" "$BOX_SHA" > "$WORK/installed"
put 0644 "$WORK/installed" "$ETC/installed"
say "installed $A_REL"
