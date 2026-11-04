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
