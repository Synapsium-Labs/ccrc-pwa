#!/usr/bin/env bash
# The test box's installer (D-7409, D-7423, D-7424, D-7451, D-7456, D-7568; plan
# docs/superpowers/plans/2026-10-29-test-box.md, Task TB7; spec §2.0, §2.2, §2.3, §9). Root, idempotent, run from the
# extracted release tree it ships in:
#
#   bash <staging>/deploy/testbox/install.sh --release <tag> --node <version> --repos <row file> [--repos <row file>]... \
#        --distro <ID>-<VERSION_ID> --push-key <public key file>
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
#      firewall and IPAddressAllow= take addresses); every egress name is a row of spec §2.0's table; the row file and
#      the push key read; CCRC_TESTBOX_ROOT's filesystem is XFS with reflink=1; the distribution release is --distro's.
#   2. the first release: <staging> copied to <tools>/release/<tag>, root's, no group or other write, and
#      <tools>/release/installed linked to it in one rename; refused when any path of that tree is then not root's or is
#      writable by group or other.
#   3. the verifier's node: TB6's `_tbt_node_install` (the one function the tool sync calls too), then the bootstrap
#      set <tools>/sets/s.bootstrap holding the one link `node`, and <tools>/current naming it in one rename.
#   4. the verifier's dependencies: `npm ci --omit=dev --ignore-scripts` in <tools>/release/<tag>/server under that
#      node, straight from CCRC_TESTBOX_REGISTRY_UPSTREAM (the firewall is not loaded yet).
#   5. the users and groups, the box file's group and mode (the service user's, 0640), CCRC_TESTBOX_ROOT's
#      directories, the repository rows and their mirrors, the units with their drop-ins, the polkit rule, the firewall
#      file and the egress names.
#   6. last: the firewall loaded, the service and the egress timer enabled and started, and the installed marker
#      (<etc>/installed: the tag and the box file's sha256) written.
# A re-run with the installed marker present changes nothing when the box file's sha256 and the tag are the marker's;
# otherwise it runs phase 5 again, reloads the firewall and the system manager, restarts the service, refreshes the
# egress sets and records the new tag and sha256.
#
# Every system call goes through one seam, TB_SYS (empty on a box: the command runs as it is), so the tests run this
# into a fixture root as a non-root user. The files a system reads (units, drop-ins, the rule, the firewall file) are
# written under the box file's own root, the part of `_tb_box_env_file` before its /etc/, which is / on a box.
set -uo pipefail
umask 022

TBI_PROG=ccrc-testbox-install
TBI_GIT_GROUP=ccrc-tb-git
TBI_RE_TAG='^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
TBI_RE_NODE='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'

refuse() { printf '%s: refused: %s; nothing was written\n' "$TBI_PROG" "$*" >&2; exit 1; }
fail() { printf '%s: failed: %s\n' "$TBI_PROG" "$*" >&2; exit 1; }
say() { printf '%s: %s\n' "$TBI_PROG" "$*" >&2; }
_sys() { if [ -n "${TB_SYS:-}" ]; then "$TB_SYS" "$@"; else "$@"; fi; }
_tbi_sha256() { local l; l=$(_plat_sha256 "$1") || return 1; printf '%s\n' "${l%% *}"; }   # ccd/ccrc's wrapper
_tbi_git() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY GIT_CONFIG_NOSYSTEM=1 git "$@"; }

# ── the arguments ────────────────────────────────────────────────────────
usage() { printf 'usage: install.sh --release <tag> --node <version> --repos <row file>... --distro <ID>-<VERSION_ID> --push-key <file>\n' >&2; exit 2; }
A_REL='' A_NODE='' A_DISTRO='' A_KEY=''
A_REPOS=()
while (($#)); do
  case $1 in
    --release) (($# >= 2)) || usage; A_REL=$2; shift 2 ;;
    --node) (($# >= 2)) || usage; A_NODE=$2; shift 2 ;;
    --repos) (($# >= 2)) || usage; A_REPOS+=("$2"); shift 2 ;;
    --distro) (($# >= 2)) || usage; A_DISTRO=$2; shift 2 ;;
    --push-key) (($# >= 2)) || usage; A_KEY=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$A_REL" ] && [ -n "$A_NODE" ] && [ "${#A_REPOS[@]}" -gt 0 ] && [ -n "$A_DISTRO" ] && [ -n "$A_KEY" ] || usage

TBI_HERE=${BASH_SOURCE[0]}
[[ $TBI_HERE == */* ]] || TBI_HERE=./$TBI_HERE
TBI_HERE=$(cd "${TBI_HERE%/*}" && pwd) || refuse "cannot find the installer's directory"
STAGING=${TBI_HERE%/deploy/testbox}
[ "$STAGING" != "$TBI_HERE" ] || refuse "not run from a release tree's deploy/testbox: $TBI_HERE"

# ── phase 1: the refusals ────────────────────────────────────────────────
while IFS= read -r v; do case $v in CCRC_TESTBOX_*) unset "$v" ;; esac; done < <(compgen -e)
# shellcheck source=/dev/null  # the staging tree's own ccd/testbox-knobs
. "$STAGING/ccd/testbox-knobs" || refuse "cannot load $STAGING/ccd/testbox-knobs"
BOXFILE=$(_tb_box_env_file)
_tb_box_file_ok "$BOXFILE" || refuse "the box file: $TB_BOX_WHY"
PROG=$TBI_PROG _tb_load box || refuse "the box file's settings cannot be read"
if [ "${#TBK_WARN[@]}" -gt 0 ]; then
  for w in "${TBK_WARN[@]}"; do printf '%s\n' "$w" >&2; done
  refuse "the box file holds a value that is not its setting's shape (above)"
fi
k() { printf '%s' "${TBK[$1]}"; }

# The staging tree's own per-file digests, through ccd/ccrc's platform wrapper (the check `_upd_fetch` makes after its
# extraction): the first release is trusted on its transport checksum and this (D-7424).
( cd "$STAGING" && _plat_sha256_check MANIFEST ) >/dev/null 2>&1 || refuse "the staging tree does not match its MANIFEST"
[[ $A_REL =~ $TBI_RE_TAG ]] || refuse "--release $A_REL is not a release tag"
bj=$(cat -- "$STAGING/build.json" 2>/dev/null) || refuse "the staging tree has no build.json"
[[ $bj =~ \"version\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] || refuse "build.json names no version"
[ "${BASH_REMATCH[1]}" = "$A_REL" ] || refuse "build.json's version ${BASH_REMATCH[1]} is not --release $A_REL"
[[ $A_NODE =~ $TBI_RE_NODE ]] || refuse "--node $A_NODE is not a version"

for key in CCRC_TESTBOX_ROOT CCRC_TESTBOX_REPOS CCRC_TESTBOX_TOOLS_DIR; do
  case $(k "$key") in /*) ;; *) refuse "$key=$(k "$key") is not an absolute path (the installer has no reader's home)" ;; esac
done
ROOT=$(k CCRC_TESTBOX_ROOT) REPOS=$(k CCRC_TESTBOX_REPOS) TOOLS=$(k CCRC_TESTBOX_TOOLS_DIR)
SVC=$(k CCRC_TESTBOX_SERVICE_USER) PUSH=$(k CCRC_TESTBOX_PUSH_USER) PREFIX=$(k CCRC_TESTBOX_RUN_USER_PREFIX) RUNS=$(k CCRC_TESTBOX_RUNS)
TREE=$TOOLS/release/installed

inst=$(readlink -- "$TOOLS/release/installed" 2>/dev/null) || inst=''
[ -z "$inst" ] || [ "${inst##*/}" = "$A_REL" ] || refuse "$TOOLS/release/installed names ${inst##*/}, not $A_REL: later releases come only through the tool sync"

ip_of() {   # <host:port> -> the host when it is an IP literal, and its family (4 or 6)
  local h=${1%:*}
  if [[ $h =~ ^\[([0-9A-Fa-f:.]+)\]$ ]]; then printf '%s 6\n' "${BASH_REMATCH[1]}"; return 0; fi
  if [[ $h =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    local o; for o in "${BASH_REMATCH[@]:1}"; do (( 10#$o <= 255 )) || return 1; done
    printf '%s 4\n' "$h"; return 0
  fi
  return 1
}
[ -n "$(k CCRC_TESTBOX_LISTEN)" ] || refuse "CCRC_TESTBOX_LISTEN is not set: the service listens on the tailnet address only"
read -r LISTEN_IP LISTEN_FAM < <(ip_of "$(k CCRC_TESTBOX_LISTEN)") || refuse "CCRC_TESTBOX_LISTEN=$(k CCRC_TESTBOX_LISTEN) does not name an IP address"
LISTEN_PORT=${TBK[CCRC_TESTBOX_LISTEN]##*:}
read -r PROXY_IP PROXY_FAM < <(ip_of "$(k CCRC_TESTBOX_REGISTRY_PROXY)") || refuse "CCRC_TESTBOX_REGISTRY_PROXY=$(k CCRC_TESTBOX_REGISTRY_PROXY) does not name an IP address"

host_of() { [[ $1 =~ ^[a-z][a-z0-9+.-]*://([^/:@]+@)?([^/:]+) ]] && printf '%s' "${BASH_REMATCH[2]}"; }
EGRESS=()   # `<row><TAB><host>` lines, the names file's
for n in $(k CCRC_TESTBOX_EGRESS_ALLOW); do
  case $n in
    github.com) EGRESS+=("github"$'\t'"$n") ;;
    nodejs.org) EGRESS+=("nodejs"$'\t'"$n") ;;
    storage.googleapis.com) EGRESS+=("chrome"$'\t'"$n") ;;
    *) refuse "CCRC_TESTBOX_EGRESS_ALLOW names $n, which is no row of spec §2.0's table" ;;
  esac
done
h=$(host_of "$(k CCRC_TESTBOX_REGISTRY_UPSTREAM)") || refuse "CCRC_TESTBOX_REGISTRY_UPSTREAM names no host"
EGRESS+=("registry"$'\t'"$h")
_tb_release_base || refuse "the release base: $TB_BOX_WHY"
# KNOB is the value `_tb_release_base` has just read from the box file in file mode (D-7457).
h=$(host_of "$KNOB") || refuse "CCRC_RELEASE_BASE_URL names no host"
EGRESS+=("release"$'\t'"$h")
SYSROOT=${BOXFILE%/etc/*}
ETC=${BOXFILE%/*}
if [ -n "$(k CCRC_TESTBOX_OS_MIRROR)" ]; then
  h=$(host_of "$(k CCRC_TESTBOX_OS_MIRROR)") || refuse "CCRC_TESTBOX_OS_MIRROR names no host"
  EGRESS+=("osmirror"$'\t'"$h")
else
  # The distribution's own mirror: the hosts the box's package sources name.
  while IFS= read -r l; do
    for w in $l; do h=$(host_of "$w") && EGRESS+=("osmirror"$'\t'"$h"); done
  done < <(cat -- "$SYSROOT/etc/apt/sources.list" "$SYSROOT"/etc/apt/sources.list.d/*.list "$SYSROOT"/etc/apt/sources.list.d/*.sources 2>/dev/null | grep -E '^[[:space:]]*(deb|URIs:)[[:space:]]' | grep -Eo '[a-z]+://[^[:space:]]+')
fi

ROW_NAMES=() ROW_MIRRORS=() ROW_URLS=() ROW_FILES=()
row_field() {   # <json> <field> -> the one string member of that name (push-command's reading of mirrorPath)
  local rest=${1#*\""$2"\"}
  [[ $rest != "$1" && $rest != *\""$2"\"* ]] || return 1
  [[ $rest =~ ^[[:space:]]*:[[:space:]]*\"([^\"\\]*)\" ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}"
}
for f in "${A_REPOS[@]}"; do
  [ -f "$f" ] && [ ! -L "$f" ] && [ -r "$f" ] || refuse "--repos $f is not a readable regular file"
  n=${f##*/}; n=${n%.json}
  [[ ${f##*/} == "$n.json" && $n =~ ^[a-z0-9][a-z0-9._-]*$ ]] || refuse "--repos $f is not named <name>.json"
  t=$(cat -- "$f") || refuse "cannot read $f"
  [[ $t == *\"name\"*:*\""$n"\"* ]] || refuse "repository row $f does not name $n"
  m=$(row_field "$t" mirrorPath) && [[ $m == /* && "/$m/" != */../* && "/$m/" != */./* ]] || refuse "repository row $n has no one absolute mirrorPath"
  u=$(row_field "$t" fetchUrl) && [[ $u =~ ^(https|ssh):// ]] || refuse "repository row $n has no one https or ssh fetchUrl"
  case " ${ROW_NAMES[*]} " in *" $n "*) refuse "repository row $n is named twice" ;; esac
  ROW_NAMES+=("$n"); ROW_MIRRORS+=("$m"); ROW_URLS+=("$u"); ROW_FILES+=("$f")
done
PUSH_LINE=$(head -n 1 -- "$A_KEY" 2>/dev/null) || PUSH_LINE=''
[[ $PUSH_LINE =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ssh-rsa)[[:space:]]+([A-Za-z0-9+/]+=*)([[:space:]].*)?$ ]] \
  || refuse "--push-key $A_KEY holds no public key line"
PUSH_KEY="${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"

# The run root's filesystem: XFS with reflink=1 (spec §2.2 "XFS, settled").
p=$ROOT; while [ ! -e "$p" ] && [ "$p" != / ]; do p=$(dirname -- "$p"); done
read -r fstype target < <(_sys findmnt -n -o FSTYPE,TARGET -T "$p" 2>/dev/null) || fstype=''
[ "$fstype" = xfs ] || refuse "CCRC_TESTBOX_ROOT=$ROOT is on ${fstype:-an unknown filesystem}, not XFS"
_sys xfs_info "$target" 2>/dev/null | grep -Eq '(^|[[:space:],])reflink=1([[:space:],]|$)' || refuse "CCRC_TESTBOX_ROOT=$ROOT is on XFS without reflink=1"
# The distribution release (D-7423).
osr="$SYSROOT/etc/os-release"; [ -f "$osr" ] || osr="$SYSROOT/usr/lib/os-release"
os_id='' os_ver=''
while IFS= read -r l; do
  case $l in ID=*) os_id=${l#ID=}; os_id=${os_id//\"/} ;; VERSION_ID=*) os_ver=${l#VERSION_ID=}; os_ver=${os_ver//\"/} ;; esac
done < "$osr" 2>/dev/null
[ "$os_id-$os_ver" = "$A_DISTRO" ] || refuse "the box runs ${os_id:-?}-${os_ver:-?}, not --distro $A_DISTRO"

BOX_SHA=$(_tbi_sha256 "$BOXFILE") || refuse "cannot hash $BOXFILE"
MARK_TAG='' MARK_SHA=''
if [ -f "$ETC/installed" ]; then
  while IFS=$'\t' read -r a b; do case $a in release) MARK_TAG=$b ;; box-sha256) MARK_SHA=$b ;; esac; done < "$ETC/installed"
fi
if [ -n "$MARK_TAG" ] && [ "$MARK_TAG" = "$A_REL" ] && [ "$MARK_SHA" = "$BOX_SHA" ]; then
  say "$A_REL is installed and the box file is unchanged; nothing to do"
  exit 0
fi

# ── phase 2: the first release (D-7424) ──────────────────────────────────
dir() { _sys install -d -m "$1" -o "$2" -g "$3" "$4" || fail "cannot make $4"; }
put() { _sys install -m "$1" -o root -g root "$2" "$3" || fail "cannot write $3"; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-testbox-install.XXXXXX") || fail "no temporary directory"
trap 'rm -rf -- "$WORK"' EXIT
if [ -z "$MARK_TAG" ]; then
  say "phase 2: the release $A_REL"
  dir 0755 root root "$TOOLS"
  dir 0755 root root "$TOOLS/release"
  dst=$TOOLS/release/$A_REL
  if [ ! -d "$dst" ]; then
    st=$TOOLS/release/.stage.$A_REL
    rm -rf -- "$st"
    cp -RP -- "$STAGING" "$st" || fail "cannot copy the staging tree"
    chmod -R go-w "$st" || fail "cannot remove group and other write under $st"
    _sys chown -R -h root:root "$st" || fail "cannot give $st to root"
    mv -- "$st" "$dst" || fail "cannot place $dst"
  fi
  owner=$(_tb_box_owner_uid)
  bad=$(find "$dst" \( ! -user "$owner" -o -perm -g+w -o -perm -o+w \) ! -type l -print -quit 2>/dev/null)
  [ -z "$bad" ] || fail "$bad is writable by someone other than root"
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

  # ── phase 4: the verifier's dependencies ───────────────────────────────
  say "phase 4: the release's server/ production dependencies"
  if [ -f "$dst/server/package.json" ]; then
    ( cd -- "$dst/server" && PATH="$TOOLS/node/$A_NODE/bin:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
        --registry="$(k CCRC_TESTBOX_REGISTRY_UPSTREAM)" ) >/dev/null || fail "npm ci --omit=dev --ignore-scripts failed in $dst/server"
    chmod -R go-w "$dst/server" || fail "cannot remove group and other write under $dst/server"
    _sys chown -R -h root:root "$dst/server" || fail "cannot give $dst/server to root"
  fi
fi

# ── phase 5: users, directories, rows, mirrors, units, rule, firewall file ─
say "phase 5: users, directories, units, the rule and the firewall file"
have_user() { _sys getent passwd "$1" >/dev/null 2>&1; }
have_group() { _sys getent group "$1" >/dev/null 2>&1; }
user() {   # <name> <home> <shell> [--create-home]
  have_user "$1" && return 0
  _sys useradd --system --user-group --home-dir "$2" --shell "$3" ${4:+"$4"} "$1" || fail "cannot add the user $1"
}
have_group "$TBI_GIT_GROUP" || _sys groupadd --system "$TBI_GIT_GROUP" || fail "cannot add the group $TBI_GIT_GROUP"
user "$SVC" "$SYSROOT/var/lib/$SVC" /usr/sbin/nologin --create-home
user "$PUSH" "$SYSROOT/var/lib/$PUSH" /usr/bin/git-shell
for ((i = 1; i <= RUNS; i++)); do user "$PREFIX$i" /nonexistent /usr/sbin/nologin; done
user "${PREFIX}install" /nonexistent /usr/sbin/nologin
_sys usermod -a -G "$TBI_GIT_GROUP" "$SVC" || fail "cannot add $SVC to $TBI_GIT_GROUP"
_sys usermod -a -G "$TBI_GIT_GROUP" "$PUSH" || fail "cannot add $PUSH to $TBI_GIT_GROUP"
# The box file: root's, the service user's group, 0640, so the run users cannot read it (D-7451). Never a value.
_sys chown "root:$SVC" "$BOXFILE" || fail "cannot give $BOXFILE to the service user's group"
_sys chmod 0640 "$BOXFILE" || fail "cannot set $BOXFILE's mode"

# CCRC_TESTBOX_ROOT (spec §2.2): root's where a run or an install must not write, the service's where it does.
dir 0755 root root "$ROOT"
for d in runs install pristine; do dir 0755 root root "$ROOT/$d"; done
for ((i = 1; i <= RUNS; i++)); do dir 0755 root root "$ROOT/runs/$i"; done
dir 0755 "$SVC" "$SVC" "$ROOT/specs"
for d in results logs out registry handover; do dir 0750 "$SVC" "$SVC" "$ROOT/$d"; done
for ((i = 1; i <= RUNS; i++)); do dir 0750 "$SVC" "$SVC" "$ROOT/out/$i"; done
dir 0750 "$SVC" "$SVC" "$ROOT/out/install"

# The push user's one key (spec §2.1): its forced command and the repository table it checks.
dir 0755 root root "$SYSROOT/var/lib/$PUSH"
dir 0755 root root "$SYSROOT/var/lib/$PUSH/.ssh"
printf 'restrict,command="%s %s" %s\n' "$TREE/deploy/testbox/git/push-command" "$REPOS" "$PUSH_KEY" > "$WORK/authorized_keys"
put 0644 "$WORK/authorized_keys" "$SYSROOT/var/lib/$PUSH/.ssh/authorized_keys"

# The repository rows and their mirrors (spec §2.1 "The mirror"): a bare repository the service fetches into on its
# timer (nothing is fetched here), group ccrc-tb-git and core.sharedRepository=0664 so the push user's pushes and the
# service's fetch and gc share it; its config and its hooks directory (the installed release's deploy/testbox/git,
# TB3's hook) are root's.
dir 0755 root root "$REPOS"
for i in "${!ROW_NAMES[@]}"; do
  put 0644 "${ROW_FILES[$i]}" "$REPOS/${ROW_NAMES[$i]}.json"
  m=${ROW_MIRRORS[$i]}
  dir 0755 root root "$(dirname -- "$m")"
  if [ ! -d "$m" ]; then _tbi_git init -q --bare --shared=0664 "$m" >/dev/null || fail "cannot make the mirror $m"; fi
  for kv in "core.sharedRepository=0664" "core.hooksPath=$TREE/deploy/testbox/git" "remote.origin.url=${ROW_URLS[$i]}" \
    "remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*"; do
    _tbi_git -C "$m" config "${kv%%=*}" "${kv#*=}" || fail "cannot configure the mirror $m (${kv%%=*})"
  done
  _sys chown -R "$SVC:$TBI_GIT_GROUP" "$m" || fail "cannot give the mirror $m to $SVC"
  _sys chown root:root "$m/config" || fail "cannot give $m/config to root"
  _sys chmod 0644 "$m/config" || fail "cannot set $m/config's mode"
  # Group-writable for the lock files git makes beside config, and sticky, so no group member can replace a file it
  # does not own there: root's config stays root's (D-7568).
  _sys chmod 3775 "$m" || fail "cannot set $m's mode"
done

# The units, with the installed tree's and the tools directory's absolute paths, and their drop-ins from the box file.
render() {   # <template> <out>: the placeholders replaced
  local t
  t=$(cat -- "$1") || return 1
  t=${t//@@TREE@@/$TREE}; t=${t//@@TOOLS@@/$TOOLS}; t=${t//@@ROOT@@/$ROOT}; t=${t//@@ETC@@/$ETC}
  t=${t//@@SERVICE_USER@@/$SVC}; t=${t//@@LISTEN_PORT@@/$LISTEN_PORT}
  if [ "$LISTEN_FAM" = 6 ]; then t=${t//@@LISTEN_MATCH@@/ip6 daddr $LISTEN_IP}; else t=${t//@@LISTEN_MATCH@@/ip daddr $LISTEN_IP}; fi
  printf '%s\n' "$t" > "$2"
}
UNITDIR=$SYSROOT/etc/systemd/system
dir 0755 root root "$UNITDIR"
for f in "$TREE"/deploy/testbox/systemd/*; do
  render "$f" "$WORK/unit" || fail "cannot render $f"
  put 0644 "$WORK/unit" "$UNITDIR/${f##*/}"
done
if [ "$PROXY_FAM" = 6 ]; then proxy_net="$PROXY_IP/128"; else proxy_net="$PROXY_IP/32"; fi
max=$(k CCRC_TESTBOX_UNIT_MAX)
dropin() {   # <unit> <body>
  dir 0755 root root "$UNITDIR/$1.d"
  printf '# Written by deploy/testbox/install.sh from the box file (D-7451); a re-run of the installer rewrites it.\n%s\n' "$2" > "$WORK/dropin"
  put 0644 "$WORK/dropin" "$UNITDIR/$1.d/50-ccrc-testbox.conf"
}
dropin ccrc-testbox.service $'[Service]\n'"User=$SVC"$'\n'"Group=$SVC"
dropin ccrc-testbox-prepare@.service $'[Service]\n'"User=$PREFIX%i"$'\n'"IPAddressAllow=$proxy_net"$'\n'"RuntimeMaxSec=$max"
dropin ccrc-testbox-run@.service $'[Service]\n'"User=$PREFIX%i"$'\n'"RuntimeMaxSec=$max"
dropin ccrc-testbox-clean@.service $'[Service]\n'"RuntimeMaxSec=$max"
dropin ccrc-testbox-install.service $'[Service]\n'"User=${PREFIX}install"$'\n'"IPAddressAllow=$proxy_net"$'\n'"RuntimeMaxSec=$max"
caps=$'[Slice]\n'"MemoryMax=$(k CCRC_TESTBOX_RUN_MEMORY_MAX)"$'\n'"MemorySwapMax=$(k CCRC_TESTBOX_RUN_SWAP_MAX)"$'\n'"CPUQuota=$(k CCRC_TESTBOX_RUN_CPU_QUOTA)"
dropin ccrc-testbox-run-.slice "$caps"
dropin ccrc-testbox-install.slice "$caps"
# The firewall is loaded at boot after the distribution's own rules (nftables.service), and by phase 6 now.
dropin nftables.service $'[Service]\n'"ExecStartPost=/usr/sbin/nft -f $ETC/ccrc-testbox.nft"

RULEDIR=$SYSROOT/etc/polkit-1/rules.d
dir 0755 root root "$RULEDIR"
render "$TREE/deploy/testbox/polkit/50-ccrc-testbox.rules" "$WORK/rule" || fail "cannot render the polkit rule"
put 0644 "$WORK/rule" "$RULEDIR/50-ccrc-testbox.rules"
render "$TREE/deploy/testbox/nft/ccrc-testbox.nft" "$WORK/nft" || fail "cannot render the firewall"
put 0644 "$WORK/nft" "$ETC/ccrc-testbox.nft"
printf '%s\n' "${EGRESS[@]}" > "$WORK/egress"
put 0644 "$WORK/egress" "$ETC/egress"

# ── phase 6: the firewall, the service, the marker ───────────────────────
say "phase 6: the firewall, the service and the marker"
_sys nft -f "$ETC/ccrc-testbox.nft" || fail "nft refused $ETC/ccrc-testbox.nft"
_sys systemctl daemon-reload || fail "systemctl daemon-reload failed"
if [ -z "$MARK_TAG" ]; then
  _sys systemctl enable nftables.service || fail "cannot enable nftables.service"
  _sys systemctl enable --now ccrc-testbox.service ccrc-testbox-egress.timer || fail "cannot start the test service"
else
  _sys systemctl restart ccrc-testbox.service || fail "cannot restart the test service"
fi
_sys systemctl start ccrc-testbox-egress.service || say "the egress sets were not all filled; ccrc-testbox-egress.timer tries again"
printf 'release\t%s\nbox-sha256\t%s\n' "$A_REL" "$BOX_SHA" > "$WORK/installed"
put 0644 "$WORK/installed" "$ETC/installed"
say "installed $A_REL"
