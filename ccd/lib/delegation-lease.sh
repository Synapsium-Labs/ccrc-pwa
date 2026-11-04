# ccd/lib/delegation-lease.sh — the delegation broker's lease carrier on the fleet box (wave 5, D-7798).
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/disk-retention.sh and ccd/lib/train-proof.sh and after every other function and variable of ccd is defined, and
# these functions call those. It carries the delegation broker's workspace-lifecycle verbs: server-composed only (through
# `CCD_ARGV` behind a capability the box reports), on the SAFETY list, named in no skill. It holds:
#   1. the leases directory (`$REG/delegation/leases`, with `.locks/` and `by-tree/`), made only by the verb, never at a spawn;
#   2. the carrier reader and the per-tree index (`by-tree/<key>` names the one lease of a tree, D-7799);
#   3. the tree resolver, the creation-base reader and the box-side fingerprint;
#   4. `ccd ws-lease-mark` (`cmd_ws_lease_mark`), the carrier's ONE writer: generation-strict, flocked and atomic.
#
# THE TRUST CHAIN is ccd/lib/disk-retention.sh's: installed beside ccd's body (`~/.local/libexec/ccrc/lib/delegation-lease.sh`)
# by `ccd/ccd-entry-install.py`, pinned by the body (`__CCD_LIB_LEASE_SHA256`, near the foot of ccd/ccd, written at install
# time), read once, hashed and evaluated from the same bytes; a missing, linked or changed file refuses the start
# (`ccd: refused (lib-...)`, status 125) before any verb runs. The file ends in exactly one newline and holds no NUL byte.

# @ccd-lib:lease
_dl_leases_dir() {   # -> prints $REG/delegation/leases after making it, .locks/ and by-tree/ (0700); rc 1, nothing made, when
                     #    $REG/delegation or any of the three is a link or a non-directory
  local LC_ALL=C base="$REG/delegation" d
  local root="$base/leases"
  for d in "$base" "$root" "$root/.locks" "$root/by-tree"; do
    if [[ -L "$d" ]]; then return 1; fi
    if [[ -e "$d" ]]; then
      [[ -d "$d" && ! -L "$d" ]] || return 1
    else
      mkdir -m 0700 -- "$d" 2>/dev/null || return 1
      [[ -d "$d" && ! -L "$d" ]] || return 1
    fi
  done
  chmod -- 0700 "$root" "$root/.locks" "$root/by-tree" 2>/dev/null || return 1
  printf '%s\n' "$root"
}

__DL_LEASE_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
__DL_CARRIER_MAX=16384      # bytes; a larger carrier is malformed, never read
# The carrier's closed words, as `shared/api.ts` declares them (DELEGATION_CARRIER_STATES, DELEGATION_LEASE_SOURCE_KINDS,
# DELEGATION_LEASE_RELEASE_REASONS); the holding states are the ones the orphan rung and `tree-held` respect (D-7804).
__DL_STATES='ephemeral adopted retained promoted transferring released'
__DL_HOLDING='adopted retained transferring'
__DL_SOURCES='agent workflow raw attached'
__DL_REASONS='native-removed transferred foreign'

# The carrier reader's python: one fixed program, the carrier's path its only file argument. It opens without following a
# link, refuses a non-regular file and one past the size bound, and checks every key and value against the carrier's
# grammar, and that it records the lease its file name names; it prints `OK` and NUL-separated `field=value` pairs (null as the empty value, and `body`, the carrier less
# `markedAt` in its own key order), `ABSENT`, or `BAD` and a reason. Nothing it prints is ever evaluated.
__DL_CARRIER_PY='import json, os, re, stat, sys
p, mx, want = sys.argv[1], int(sys.argv[2]), sys.argv[3]
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
REGID = re.compile(r"(?!-)[A-Za-z0-9._-]{1,128}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
BASE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
STATES = ("ephemeral", "adopted", "retained", "promoted", "transferring", "released")
SOURCES = ("agent", "workflow", "raw", "attached")
REASONS = ("native-removed", "transferred", "foreign")
KEYS = ("v", "leaseId", "generation", "state", "journalSeq", "parentId", "parentIncarnation", "activityId", "source",
        "project", "adminRecord", "canonicalPath", "fingerprint", "claudeBase", "branch", "expiresAt", "releaseReason",
        "promotedRun", "promotedSession", "markedAt")
def out(*parts):
    sys.stdout.write("".join(x + "\0" for x in parts)); sys.exit(0)
def bad(why): out("BAD", why)
try:
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
except FileNotFoundError:
    out("ABSENT")
except OSError as e:
    bad("it could not be opened (%s)" % e.strerror)
if not stat.S_ISREG(os.fstat(fd).st_mode): bad("it is not a regular file")
data = b""
while len(data) <= mx:
    chunk = os.read(fd, mx + 1 - len(data))
    if not chunk: break
    data += chunk
if len(data) > mx: bad("it is larger than %d bytes" % mx)
def pairs(kv):
    d = {}
    for k, v in kv:
        if k in d: raise ValueError("key %s repeats" % k)
        d[k] = v
    return d
try:
    doc = json.loads(data.decode("utf-8"), object_pairs_hook=pairs)
except (ValueError, UnicodeDecodeError) as e:
    bad("it is not one JSON object (%s)" % e)
if not isinstance(doc, dict) or tuple(sorted(doc)) != tuple(sorted(KEYS)): bad("its keys are not the carrier keys")
def num(v, lo=1, hi=10**16): return type(v) is int and lo <= v < hi
def word(v, rx): return isinstance(v, str) and rx.match(v) is not None
ok = (doc["v"] == 1 and type(doc["v"]) is int and word(doc["leaseId"], UUID) and num(doc["generation"], 1, 10**10)
      and doc["state"] in STATES and num(doc["journalSeq"], 1, 10**10) and word(doc["parentId"], REGID)
      and word(doc["parentIncarnation"], UUID) and word(doc["activityId"], re.compile(r"[A-Za-z0-9._:-]{1,200}\Z"))
      and doc["source"] in SOURCES and word(doc["project"], re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]{0,254}\Z"))
      and word(doc["adminRecord"], re.compile(r"[A-Za-z0-9._@+-]{1,255}\Z")) and doc["adminRecord"] not in (".", "..")
      and isinstance(doc["canonicalPath"], str) and doc["canonicalPath"].startswith("/") and "\0" not in doc["canonicalPath"]
      and word(doc["fingerprint"], HEX64) and word(doc["claudeBase"], BASE)
      and (doc["branch"] is None or (isinstance(doc["branch"], str) and doc["branch"] != "" and "\0" not in doc["branch"]))
      and (doc["expiresAt"] is None or num(doc["expiresAt"]))
      and (doc["releaseReason"] is None or doc["releaseReason"] in REASONS)
      and (doc["releaseReason"] is not None) == (doc["state"] == "released")
      and (doc["promotedRun"] is None or num(doc["promotedRun"], 1, 10**10))
      and (doc["promotedSession"] is None or word(doc["promotedSession"], REGID))
      and (doc["promotedRun"] is not None) == (doc["state"] == "promoted") == (doc["promotedSession"] is not None)
      and num(doc["markedAt"]))
if not ok: bad("a value is out of the carrier grammar")
if doc["leaseId"] != want: bad("it records lease %s, not the lease its name says" % doc["leaseId"])
body = json.dumps({k: v for k, v in doc.items() if k != "markedAt"}, separators=(",", ":"))
vals = ["%s=%s" % (k, "" if doc[k] is None else doc[k]) for k in KEYS]
out("OK", *vals, "body=" + body)
'

_dl_dirs_measured() {   # <dir>... (each the next one's parent, the first under $REG) -> rc 0 each is a searchable directory and
                        #    no link; rc 3 the first one missing is PROVEN absent (no entry of that name under a searchable parent
                        #    now; whether one stood there before is not measured); rc 4 a link, a non-directory or an unsearchable
                        #    one (DL_WHY)
  local d
  [[ -d "$REG" && -x "$REG" ]] || { DL_WHY="the registry $REG is not a searchable directory"; return 4; }
  for d in "$@"; do
    [[ ! -L "$d" ]] || { DL_WHY="$d is a link, which is never followed"; return 4; }
    [[ -e "$d" ]] || return 3
    [[ -d "$d" && -x "$d" ]] || { DL_WHY="$d is not a searchable directory, so nothing under it can be proven absent"; return 4; }
  done
}

_dl_carrier_read() {   # <leaseId> -> rc 0 with DL_C_<field> set; rc 3 PROVEN absent (no entry, no link); rc 4 anything else
                       #    (link, non-regular, oversize, unreadable, malformed JSON, a field out of grammar), DL_WHY set
  local LC_ALL=C id="${1-}" dir="$REG/delegation/leases" f kv k
  local -a out=()
  DL_WHY=''
  for k in generation state fingerprint expiresAt canonicalPath journalSeq parentId parentIncarnation claudeBase branch project adminRecord body; do
    printf -v "DL_C_$k" '%s' ''
  done
  [[ "$id" =~ $__DL_LEASE_RE ]] || { DL_WHY="'$id' is not a lease id"; return 4; }
  _dl_dirs_measured "$REG/delegation" "$dir" || return
  f="$dir/$id.json"
  [[ ! -L "$f" ]] || { DL_WHY="$f is a link, which is never read"; return 4; }
  [[ -e "$f" ]] || return 3
  [[ -f "$f" ]] || { DL_WHY="$f is not a regular file"; return 4; }
  mapfile -d '' out < <(python3 -I -c "$__DL_CARRIER_PY" "$f" "$__DL_CARRIER_MAX" "$id" 2>/dev/null)
  case "${out[0]-}" in
    OK) ;;
    ABSENT) return 3 ;;
    BAD) DL_WHY="the carrier $f is malformed: ${out[1]-}"; return 4 ;;
    *) DL_WHY="the carrier $f could not be read"; return 4 ;;
  esac
  for kv in "${out[@]:1}"; do
    k="${kv%%=*}"
    case "$k" in
      generation|state|fingerprint|expiresAt|canonicalPath|journalSeq|parentId|parentIncarnation|claudeBase|branch|project|adminRecord|body)
        printf -v "DL_C_$k" '%s' "${kv#*=}" ;;
    esac
  done
  return 0
}

_dl_tree_key() {   # <common-dir ident> <admin record> -> prints the 64-hex by-tree key (sha256 of the two, length-prefixed)
  local LC_ALL=C
  printf '%s:%s\n%s:%s\n' "${#1}" "$1" "${#2}" "$2" | _plat_sha256 | cut -d' ' -f1
}

_dl_tree_owner() {   # <key> -> rc 0 DL_OWNER=<leaseId>; rc 3 proven absent; rc 4 unreadable/malformed/link (DL_WHY)
  local LC_ALL=C key="${1-}" d="$REG/delegation/leases/by-tree" f v
  DL_OWNER=''; DL_WHY=''
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || { DL_WHY="'$key' is not a tree key"; return 4; }
  _dl_dirs_measured "$REG/delegation" "$REG/delegation/leases" "$d" || return
  f="$d/$key"
  [[ ! -L "$f" ]] || { DL_WHY="the by-tree entry $f is a link"; return 4; }
  [[ -e "$f" ]] || return 3
  [[ -f "$f" && -r "$f" ]] || { DL_WHY="the by-tree entry $f is not a readable regular file"; return 4; }
  { v=$(<"$f"); } 2>/dev/null || { DL_WHY="the by-tree entry $f could not be read"; return 4; }
  [[ "$v" =~ $__DL_LEASE_RE ]] || { DL_WHY="the by-tree entry $f does not hold one lease id"; return 4; }
  DL_OWNER="$v"
}

_dl_tree_of_record() {   # <main> <admin record> -> rc 0 DL_TREE (physical) DL_TREE_REC (as git records it) DL_ADMIN DL_COMMON;
                         #    rc 3 no record or no gitdir (DL_COMMON still set); rc 4 unreadable (DL_WHY)
  local LC_ALL=C main="${1-}" rec="${2-}" common admin gd t
  DL_TREE=''; DL_TREE_REC=''; DL_ADMIN=''; DL_COMMON=''; DL_WHY=''
  common=$(_ws_common_dir "$main") || { DL_WHY="the common git directory of $main could not be read"; return 4; }
  _ws_dir_physical "$common" || { DL_WHY="the common git directory $common could not be resolved ($_WS_PHYS_WHY)"; return 4; }
  common="$_WS_PHYS"; DL_COMMON="$common"
  if [[ ! -e "$common/worktrees" && ! -L "$common/worktrees" ]]; then return 3; fi
  [[ -d "$common/worktrees" && ! -L "$common/worktrees" && -x "$common/worktrees" ]] \
    || { DL_WHY="$common/worktrees is not a searchable directory"; return 4; }
  admin="$common/worktrees/$rec"
  [[ ! -L "$admin" ]] || { DL_WHY="the admin record $admin is a link"; return 4; }
  [[ -e "$admin" ]] || return 3
  [[ -d "$admin" && -x "$admin" ]] || { DL_WHY="the admin record $admin is not a searchable directory"; return 4; }
  DL_ADMIN="$admin"
  [[ ! -L "$admin/gitdir" ]] || { DL_WHY="$admin/gitdir is a link"; return 4; }
  [[ -e "$admin/gitdir" ]] || return 3
  { gd=$(<"$admin/gitdir"); } 2>/dev/null || { DL_WHY="$admin/gitdir could not be read"; return 4; }
  [[ "$gd" == /*/.git ]] && _ws_reclaim_plain_path "$gd" \
    || { DL_WHY="$admin/gitdir does not name one plain absolute <tree>/.git"; return 4; }
  t="${gd%/.git}"; DL_TREE_REC="$t"
  [[ -e "$t" || -L "$t" ]] || return 3
  [[ -d "$t" ]] || { DL_WHY="$t, the tree $admin records, is not a directory"; return 4; }
  _ws_dir_physical "$t" || { DL_WHY="the tree $t could not be resolved ($_WS_PHYS_WHY)"; return 4; }
  DL_TREE="$_WS_PHYS"
}

_dl_creation_base() {   # <admin dir> -> prints CLAUDE_BASE's id if it is one 40/64-hex line, else the new id of logs/HEAD's
                        #    first line; rc 4 when neither reads
  local LC_ALL=C a="${1-}" f l
  f="$a/CLAUDE_BASE"
  if [[ -f "$f" && ! -L "$f" && -r "$f" ]] && { l=$(<"$f"); } 2>/dev/null && [[ "$l" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    printf '%s\n' "$l"; return 0
  fi
  f="$a/logs/HEAD"
  [[ -f "$f" && ! -L "$f" && -r "$f" ]] || return 4
  { IFS= read -r l < "$f"; } 2>/dev/null || return 4
  l="${l#* }"; l="${l%% *}"
  [[ "$l" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] || return 4
  printf '%s\n' "$l"
}

_dl_fingerprint() {   # <common> <record> <admin> <tree> <base> -> prints 64 hex over named lines (mode=lease-mark first);
                      #    rc 4 unmeasured (DL_WHY, which a caller reading this through $(...) never sees: use _dl_fingerprint_to)
  local __dl_fp
  _dl_fingerprint_to __dl_fp "$@" || return 4
  printf '%s\n' "$__dl_fp"
}

_dl_fingerprint_to() {   # <var> <common> <record> <admin> <tree> <base> -> rc 0 <var>=64 hex; rc 4 unmeasured, DL_WHY set in THIS
                         #    shell, so the reason reaches the caller's refusal
  local __dl_out="$1"; shift
  local LC_ALL=C common="$1" rec="$2" admin="$3" tree="$4" base="$5" ci ai ti gf l v
  DL_WHY=''
  _ws_path_ident "$common" || { DL_WHY="the identity of $common could not be read${_WS_IDENT_WHY:+ ($_WS_IDENT_WHY)}"; return 4; }; ci="$_WS_IDENT"
  _ws_path_ident "$admin" || { DL_WHY="the identity of $admin could not be read${_WS_IDENT_WHY:+ ($_WS_IDENT_WHY)}"; return 4; }; ai="$_WS_IDENT"
  _ws_path_ident "$tree" || { DL_WHY="the identity of $tree could not be read${_WS_IDENT_WHY:+ ($_WS_IDENT_WHY)}"; return 4; }; ti="$_WS_IDENT"
  [[ -f "$tree/.git" && ! -L "$tree/.git" && -r "$tree/.git" ]] || { DL_WHY="$tree/.git is not a readable gitfile"; return 4; }
  { IFS= read -r l < "$tree/.git"; } 2>/dev/null || { DL_WHY="$tree/.git could not be read"; return 4; }
  gf="${l#gitdir: }"
  [[ "$l" == "gitdir: "* && ( "$gf" == "$admin" || "$(_ws_realpath "$gf")" == "$admin" ) ]] \
    || { DL_WHY="$tree/.git does not name its admin record $admin"; return 4; }
  _ws_reclaim_gitdir_own "$tree" "$common" || { DL_WHY="${_WS_GITDIR_WHY:-the git directory of $tree is not its own record}"; return 4; }
  [[ "$_WS_GITDIR_DIR" == "$admin" || "$(_ws_realpath "$_WS_GITDIR_DIR")" == "$admin" ]] \
    || { DL_WHY="the git directory of $tree is $_WS_GITDIR_DIR, not $admin"; return 4; }
  v=$(_ws_reclaim_fingerprint "mode=lease-mark" "common=$ci" "record=$rec" "admin=$ai" "root=$ti" "gitfile=$gf" \
    "gitdir=$_WS_GITDIR_DIR" "base=$base") && [[ "$v" =~ ^[0-9a-f]{64}$ ]] \
    || { DL_WHY="the fingerprint of $tree could not be computed"; return 4; }
  printf -v "$__dl_out" '%s' "$v"
}

_dl_mark_refuse() {   # <word> <detail> -> prints the verb's one refusal line (never dies)
  local d
  d=$(_json_str "${2-}" 2>/dev/null) && [[ -n "$d" ]] || d='"the detail could not be quoted"'
  printf '{"ok":false,"refusal":"%s","detail":%s}\n' "$1" "$d"
}
_dl_in() { [[ "${1-}" =~ ^[a-z-]+$ && " ${2-} " == *" $1 "* ]]; }   # word list -> 0 iff word is one of list's words

# ── ccd ws-lease-mark: the carrier's one writer ──
cmd_ws_lease_mark() {   # ccd ws-lease-mark --lease <uuid> --generation <n> ... -> ONE JSON line on stdout; rc 0 written|unchanged|
                        #    index-cleared, 1 refused, 2 usage
  local LC_ALL=C
  local lease='' gen='' project='' rhex='' rec='' parent='' pinc='' act='' src='' state='' jseq='' exp='' reason='' prun='' psess=''
  local flag seen=' ' dir lfd rc
  while (( $# )); do
    flag="$1"
    case "$flag" in
      --lease|--generation|--project|--admin-record-hex|--parent|--parent-incarnation|--activity|--source|--state|--journal-seq|--expires-at|--release-reason|--promoted-run|--promoted-session) ;;
      *) _dl_mark_refuse usage "unknown argument '$flag'"; return 2 ;;
    esac
    [[ "$seen" != *" $flag "* ]] || { _dl_mark_refuse usage "$flag is given twice"; return 2; }
    (( $# >= 2 )) || { _dl_mark_refuse usage "$flag needs a value"; return 2; }
    seen+="$flag "
    case "$flag" in
      --lease) lease="$2" ;; --generation) gen="$2" ;; --project) project="$2" ;; --admin-record-hex) rhex="$2" ;;
      --parent) parent="$2" ;; --parent-incarnation) pinc="$2" ;; --activity) act="$2" ;; --source) src="$2" ;;
      --state) state="$2" ;; --journal-seq) jseq="$2" ;; --expires-at) exp="$2" ;; --release-reason) reason="$2" ;;
      --promoted-run) prun="$2" ;; --promoted-session) psess="$2" ;;
    esac
    shift 2
  done
  local u=''
  [[ "$lease" =~ $__DL_LEASE_RE ]] || u='--lease is not a lease id'
  [[ -n "$u" || "$gen" =~ ^[1-9][0-9]{0,9}$ ]] || u='--generation is not a positive integer'
  [[ -n "$u" || "$jseq" =~ ^[1-9][0-9]{0,9}$ ]] || u='--journal-seq is not a positive integer'
  [[ -n "$u" || "$project" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$ ]] || u='--project is not one path segment'
  if [[ -z "$u" ]]; then
    if [[ "$rhex" =~ ^([0-9a-f]{2}){1,255}$ ]]; then
      printf -v rec '%b' "$(printf '%s' "$rhex" | sed 's/../\\x&/g')"
      [[ "$rec" =~ ^[A-Za-z0-9._@+-]{1,255}$ && "$rec" != . && "$rec" != .. && "$(_ws_hex "$rec")" == "$rhex" ]] \
        || u='--admin-record-hex does not decode to an admin record name'
    else
      u='--admin-record-hex is not even-length lowercase hex'
    fi
  fi
  [[ -n "$u" ]] || { _reg_id_ok "$parent" && _reg_id_cap "$parent"; } || u='--parent is not a registry id'
  [[ -n "$u" || "$pinc" =~ $__DL_LEASE_RE ]] || u='--parent-incarnation is not an incarnation id'
  [[ -n "$u" || "$act" =~ ^[A-Za-z0-9._:-]{1,200}$ ]] || u='--activity is not an activity id'
  [[ -n "$u" ]] || _dl_in "$src" "$__DL_SOURCES" || u='--source is not a lease source'
  [[ -n "$u" ]] || _dl_in "$state" "$__DL_STATES" || u='--state is not a carrier state'
  [[ -n "$u" || "$seen" != *' --expires-at '* || "$exp" =~ ^[1-9][0-9]{0,15}$ ]] || u='--expires-at is not epoch milliseconds'
  if [[ -z "$u" ]]; then
    if [[ "$state" == released ]]; then
      _dl_in "$reason" "$__DL_REASONS" || u='--state released needs --release-reason native-removed|transferred|foreign'
    elif [[ "$seen" == *' --release-reason '* ]]; then
      u='--release-reason is given only with --state released'
    fi
  fi
  if [[ -z "$u" ]]; then
    if [[ "$state" == promoted ]]; then
      { _child_runid_valid "$prun" && _reg_id_ok "$psess" && _reg_id_cap "$psess"; } \
        || u='--state promoted needs --promoted-run <id> and --promoted-session <id>'
    elif [[ "$seen" == *' --promoted-run '* || "$seen" == *' --promoted-session '* ]]; then
      u='--promoted-run and --promoted-session are given only with --state promoted'
    fi
  fi
  [[ -z "$u" ]] || { _dl_mark_refuse usage "$u"; return 2; }

  _json_str probe >/dev/null 2>&1 || { printf '%s\n' '{"ok":false,"refusal":"unmeasured","detail":"python3 is unavailable, so the carrier cannot be read or quoted"}'; return 1; }
  command -v flock >/dev/null 2>&1 || { _dl_mark_refuse unmeasured "flock (util-linux) is unavailable, so the mark cannot be serialised"; return 1; }
  dir=$(_dl_leases_dir) && [[ -n "$dir" ]] \
    || { _dl_mark_refuse unmeasured "$REG/delegation/leases could not be made a private directory (a link or a non-directory stands in its path)"; return 1; }
  { exec {lfd}>>"$dir/.locks/$lease.lock"; } 2>/dev/null \
    || { _dl_mark_refuse unmeasured "the lock $dir/.locks/$lease.lock could not be opened"; return 1; }
  flock -n "$lfd" || { exec {lfd}>&-; _dl_mark_refuse busy "another ws-lease-mark holds the lock of lease $lease"; return 1; }
  _ws_reclaim_contained _dl_mark_locked; rc=$?
  exec {lfd}>&-
  return "$rc"
}

_dl_mark_locked() {   # everything the lock serialises (the flags, $dir and $rec are cmd_ws_lease_mark's)
  local crc s_gen=0 s_fp='' s_path='' s_base='' s_branch='' s_body='' s_proj='' s_rec='' pr wr main mr ci key trc
  local tp='' admin='' common troot below comp cls host='' chk sp wd f fp base branch tip orc owner index=none
  # rule 4: the stored carrier
  _dl_carrier_read "$lease"; crc=$?
  case "$crc" in
    0) s_gen="$DL_C_generation"; s_fp="$DL_C_fingerprint"; s_path="$DL_C_canonicalPath"; s_base="$DL_C_claudeBase"
       s_branch="$DL_C_branch"; s_body="$DL_C_body"; s_proj="$DL_C_project"; s_rec="$DL_C_adminRecord" ;;
    3) ;;
    *) _dl_mark_refuse bad-carrier "$DL_WHY; nothing was written"; return 1 ;;
  esac
  if (( crc == 3 )) && [[ "$state" != released ]] && (( gen != 1 )); then
    _dl_mark_refuse stale-generation "no carrier of lease $lease is stored, so its first mark is generation 1, not $gen"; return 1
  fi
  if (( crc == 0 && 10#$gen < 10#$s_gen )); then
    _dl_mark_refuse stale-generation "the stored carrier is at generation $s_gen, above $gen"; return 1
  fi
  # a release keeps the stored fingerprint (rule 11, D-7937), so it proves here that it names the lease's own record and project
  if (( crc == 0 )) && [[ "$state" == released && ( "$project" != "$s_proj" || "$rec" != "$s_rec" ) ]]; then
    _dl_mark_refuse fingerprint-mismatch "lease $lease's carrier records project $s_proj and admin record $s_rec, not $project and $rec; nothing was written"
    return 1
  fi
  # rule 5: the main checkout and the tree its admin record names
  _ws_dir_physical "$PROJECTS_ROOT" || { _dl_mark_refuse unmeasured "the projects root could not be resolved ($_WS_PHYS_WHY)"; return 1; }
  pr="$_WS_PHYS"
  wr=''; if [[ -d "$WORKTREES_ROOT" ]] && _ws_dir_physical "$WORKTREES_ROOT"; then wr="$_WS_PHYS"; fi
  main="$PROJECTS_ROOT/$project"
  [[ -d "$main" && ! -L "$main" ]] && _ws_dir_physical "$main" && mr="$_WS_PHYS" && [[ "$mr" == "$pr/$project" ]] \
    || { _dl_mark_refuse not-under-projects-root "$main is not a directory directly under the physical projects root"; return 1; }
  _dl_tree_of_record "$mr" "$rec"; trc=$?
  [[ -n "$DL_COMMON" ]] || { _dl_mark_refuse unmeasured "$DL_WHY"; return 1; }
  common="$DL_COMMON"
  _ws_path_ident "$common" || { _dl_mark_refuse unmeasured "the identity of $common could not be read${_WS_IDENT_WHY:+ ($_WS_IDENT_WHY)}"; return 1; }
  ci="$_WS_IDENT"; key=$(_dl_tree_key "$ci" "$rec") && [[ "$key" =~ ^[0-9a-f]{64}$ ]] \
    || { _dl_mark_refuse unmeasured "the tree key of $rec could not be computed"; return 1; }
  if [[ "$state" == released ]] && (( crc == 3 )); then   # the index-before-carrier heal (D-7805)
    _dl_tree_owner "$key"; orc=$?
    if (( orc == 0 )) && [[ "$DL_OWNER" == "$lease" ]]; then
      rm -f -- "$dir/by-tree/$key" 2>/dev/null && [[ ! -e "$dir/by-tree/$key" ]] \
        || { _dl_mark_refuse unmeasured "the by-tree entry of $rec could not be removed"; return 1; }
      printf '{"ok":true,"answer":"index-cleared","lease":"%s","generation":%s,"state":"released","fingerprint":null,"claudeBase":null,"tip":null}\n' \
        "$lease" "$gen"
      return 0
    fi
    (( orc != 4 )) || { _dl_mark_refuse unmeasured "$DL_WHY"; return 1; }
    _dl_mark_refuse no-tree "no carrier of lease $lease is stored and no by-tree entry names it; nothing was written"; return 1
  fi
  case "$trc" in
    0) tp="$DL_TREE"; admin="$DL_ADMIN" ;;
    3) [[ "$state" == released ]] \
         || { _dl_mark_refuse no-tree "$common holds no worktree record $rec with a tree; nothing was written"; return 1; } ;;
    *) _dl_mark_refuse unmeasured "$DL_WHY"; return 1 ;;
  esac
  if [[ -n "$tp" ]]; then
    # rule 6: no link below the root that holds the tree, as git recorded it
    troot=''
    for comp in "$pr" "$wr" "$PROJECTS_ROOT" "$WORKTREES_ROOT"; do
      [[ -n "$comp" && "$DL_TREE_REC" == "$comp"/?* ]] && { troot="$comp"; break; }
    done
    [[ -n "$troot" ]] \
      || { _dl_mark_refuse not-under-projects-root "the tree $DL_TREE_REC is under neither the projects root nor the ccd worktrees root"; return 1; }
    below="${DL_TREE_REC#"$troot"/}"; comp="$troot"
    while [[ -n "$below" ]]; do
      comp="$comp/${below%%/*}"; [[ "$below" == */* ]] && below="${below#*/}" || below=''
      [[ ! -L "$comp" ]] || { _dl_mark_refuse symlink "$comp, on the path of the tree $DL_TREE_REC, is a link"; return 1; }
    done
    [[ "$tp" == "$pr"/?* || ( -n "$wr" && "$tp" == "$wr"/?* ) ]] \
      || { _dl_mark_refuse not-under-projects-root "the tree $tp is under neither the physical projects root nor the ccd worktrees root"; return 1; }
    # rule 7
    [[ "$tp" != "$mr" ]] || { _dl_mark_refuse main-worktree "the admin record $rec names the main checkout $mr"; return 1; }
    if [[ "$state" != released ]]; then
      # rule 8 (O5-3)
      [[ ! -e "$admin/locked" && ! -L "$admin/locked" ]] || { _dl_mark_refuse locked "the tree $tp is locked in git"; return 1; }
      # rule 9: registered, then nested, with the orphan ladder's own location carve-out (D-7801)
      chk=$(_ws_orphan_stanzas "$mr" | cut -f1 | while IFS= read -r sp; do
              [[ -d "$sp" ]] && _ws_dir_physical "$sp" && printf '%s\n' "$_WS_PHYS" || printf '%s\n' "$sp"; done)
      cls=$(_ws_orphan_class "$tp" "$mr" "${wr:-$WORKTREES_ROOT}" "$project" "$chk")
      case "$cls" in claude|superpowers) host="${tp%/."$cls"/worktrees/*}" ;; esac
      _ws_orphan_registered "$tp" "$tp" "$cls" "$project" "${tp##*/}"
      case $? in
        0) ;;
        1) _dl_mark_refuse registered "$_WS_ORPHAN_WHY"; return 1 ;;
        *) _dl_mark_refuse unmeasured "$_WS_ORPHAN_WHY"; return 1 ;;
      esac
      for f in "$REG"/*.workdir; do
        [[ -f "$f" && ! -L "$f" && -r "$f" ]] || continue
        wd=$(<"$f"); [[ -n "$wd" ]] || continue
        [[ -d "$wd" ]] && _ws_dir_physical "$wd" && wd="$_WS_PHYS"
        if [[ "$tp" == "$wd"/* && "$wd" != "$host" ]]; then
          _dl_mark_refuse nested "registry row $(basename "$f" .workdir) has its workdir $wd around the tree $tp"; return 1
        fi
      done
      while IFS= read -r sp; do
        [[ -n "$sp" && "$sp" != "$tp" ]] || continue
        if [[ "$sp" == "$tp"/* ]] || [[ "$tp" == "$sp"/* && "$sp" != "$host" ]]; then
          _dl_mark_refuse nested "the worktree $sp and the tree $tp nest"; return 1
        fi
      done <<< "$chk"
      for f in "$dir"/*.json; do
        [[ -e "$f" || -L "$f" ]] || continue
        owner="${f##*/}"; owner="${owner%.json}"
        [[ "$owner" != "$lease" && "$owner" =~ $__DL_LEASE_RE ]] || continue
        _dl_carrier_read "$owner" || continue   # an unreadable carrier blocks its own tree, not this one (the index guards a shared tree)
        [[ "$DL_C_state" != released && "$DL_C_canonicalPath" != "$tp" ]] || continue
        if [[ "$DL_C_canonicalPath" == "$tp"/* ]] || [[ "$tp" == "$DL_C_canonicalPath"/* && "$DL_C_canonicalPath" != "$host" ]]; then
          _dl_mark_refuse nested "lease $owner's tree $DL_C_canonicalPath and the tree $tp nest"; return 1
        fi
      done
    fi
  fi
  # rule 10: the by-tree index (D-7799, D-7804); a release never takes, re-points or is refused an entry
  _dl_tree_owner "$key"; orc=$?
  case "$orc" in
    0) if [[ "$DL_OWNER" != "$lease" && "$state" != released ]]; then
         owner="$DL_OWNER"
         _dl_carrier_read "$owner"
         case $? in
           0) if _dl_in "$DL_C_state" "$__DL_HOLDING"; then
                _dl_mark_refuse tree-held "lease $owner holds this tree ($DL_C_state); nothing was written"; return 1
              fi
              index=write ;;
           3) index=write ;;
           *) _dl_mark_refuse unmeasured "the by-tree entry names lease $owner, whose carrier cannot be read: $DL_WHY"; return 1 ;;
         esac
       fi ;;
    3) [[ "$state" == released ]] || index=write ;;
    *) _dl_mark_refuse unmeasured "$DL_WHY"; return 1 ;;
  esac
  # rule 11: the fingerprint, the creation base and the branch. A release keeps what the stored carrier records (D-7937, as
  # D-7825 does for a gone tree): it writes no hold and never takes the entry (D-7934), and the record may name a new tree.
  if [[ -n "$tp" && "$state" != released ]]; then
    base=$(_dl_creation_base "$admin") \
      || { _dl_mark_refuse unmeasured "the creation base of $rec could not be read (neither CLAUDE_BASE nor logs/HEAD)"; return 1; }
    _dl_fingerprint_to fp "$common" "$rec" "$admin" "$tp" "$base" \
      || { _dl_mark_refuse unmeasured "${DL_WHY:-the fingerprint of $tp could not be computed}"; return 1; }
    if (( crc == 0 )) && [[ "$fp" != "$s_fp" ]]; then
      _dl_mark_refuse fingerprint-mismatch "the tree at $tp is not the one lease $lease's carrier records"; return 1
    fi
    branch=$(git -C "$tp" symbolic-ref --short -q HEAD 2>/dev/null) || branch=''
    tip=$(git -C "$tp" rev-parse --verify -q 'HEAD^{commit}' 2>/dev/null) || tip=''
  else
    fp="$s_fp"; base="$s_base"; branch="$s_branch"; tp="$s_path"; tip=''
  fi
  # rule 12: the body, then the index, then the carrier
  local core js q
  core="\"v\":1,\"leaseId\":\"$lease\",\"generation\":$((10#$gen)),\"state\":\"$state\",\"journalSeq\":$((10#$jseq))"
  for q in "parentId:$parent" "parentIncarnation:$pinc" "activityId:$act" "source:$src" "project:$project" \
           "adminRecord:$rec" "canonicalPath:$tp" "fingerprint:$fp" "claudeBase:$base"; do
    js=$(_json_str "${q#*:}") || { _dl_mark_refuse unmeasured "a carrier field could not be quoted"; return 1; }
    core+=",\"${q%%:*}\":$js"
  done
  if [[ -n "$branch" ]]; then js=$(_json_str "$branch") || { _dl_mark_refuse unmeasured "the branch could not be quoted"; return 1; }; else js=null; fi
  core+=",\"branch\":$js,\"expiresAt\":${exp:-null}"
  if [[ -n "$reason" ]]; then core+=",\"releaseReason\":\"$reason\""; else core+=',"releaseReason":null'; fi
  if [[ "$state" == promoted ]]; then
    js=$(_json_str "$psess") || { _dl_mark_refuse unmeasured "the promoted session could not be quoted"; return 1; }
    core+=",\"promotedRun\":$((10#$prun)),\"promotedSession\":$js"
  else
    core+=',"promotedRun":null,"promotedSession":null'
  fi
  local answer=written
  if (( crc == 0 && 10#$gen == 10#$s_gen )); then
    [[ "{$core}" == "$s_body" ]] \
      || { _dl_mark_refuse generation-conflict "the stored carrier holds another body at generation $gen; nothing was written"; return 1; }
    answer=unchanged
  fi
  local t
  if [[ "$index" == write ]]; then
    t="$dir/by-tree/.$key.$$.tmp"
    { printf '%s\n' "$lease" > "$t"; } 2>/dev/null && _plat_mv_notdir "$t" "$dir/by-tree/$key" 2>/dev/null \
      || { rm -f -- "$t" 2>/dev/null; _dl_mark_refuse unmeasured "the by-tree entry of $rec could not be written; nothing else was"; return 1; }
  fi
  if [[ "$answer" == written ]]; then
    t="$dir/.$lease.$$.tmp"
    { printf '{%s,"markedAt":%s}\n' "$core" "$(_plat_epoch_ms)" > "$t"; } 2>/dev/null && _plat_mv_notdir "$t" "$dir/$lease.json" 2>/dev/null \
      || { rm -f -- "$t" 2>/dev/null; _dl_mark_refuse unmeasured "the carrier of lease $lease could not be written; the stored one stands"; return 1; }
  fi
  if [[ -n "$tip" ]]; then tip="\"$tip\""; else tip=null; fi
  printf '{"ok":true,"answer":"%s","lease":"%s","generation":%s,"state":"%s","fingerprint":"%s","claudeBase":"%s","tip":%s}\n' \
    "$answer" "$lease" "$((10#$gen))" "$state" "$fp" "$base" "$tip"
}
