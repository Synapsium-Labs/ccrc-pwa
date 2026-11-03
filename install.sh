#!/usr/bin/env bash
# install.sh — the bootstrap, two modes, one script (stage 4, spec §3):
#   - CHECKOUT mode (default, stage 2's, unchanged): build from this
#     checkout, then hand off to `ccrc install` (ccd/ccrc), which owns every
#     converge decision.
#   - RELEASE mode (`--release [vX.Y.Z]`): download the CI-built tarball +
#     SHA256SUMS from GitHub Releases (latest, or the named tag), verify
#     `sha256sum -c`, extract to a staging dir, and hand off to the STAGED
#     `ccrc install` — no build step on the box, prebuilt dists ship in the
#     tarball. Everything after `--release [tag]` passes through to the
#     staged verb verbatim (`--role …` rides here).
# Neither mode touches ~/.ccrc, ~/.local/bin or systemd — bootstrap
# builds/fetches, the verb installs. Re-running is safe: npm ci and the
# builds are idempotent and the verb converges.
set -euo pipefail
HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}" && pwd)"

# ── The release identity — ONE owner/repo pair, spelled nowhere else.
# Stage 5 de-brands it. `CCRC_RELEASE_BASE_URL` overrides the derived
# `…/releases` prefix — the deliberate test seam, and an escape hatch for a
# mirror.
CCRC_RELEASE_OWNER="Synapsium-Labs"
CCRC_RELEASE_REPO="ccrc-pwa"

# ── The release-host bounds — the updater's five knobs, same names, same values.
# The updater reads these from ccd/ccrc (`: "${CCRC_RELEASE_…:=…}"`); this file
# is the bootstrap and sources nothing, so it holds a COPY. install-sh.test.ts
# reds when any of the five lines differs from ccd/ccrc's. The connect and
# stall bounds ride both fetches; the total-time and size bounds ride only
# SHA256SUMS (small by design — a host that keeps sending forever is not "a
# slow but live download"), as the updater's two fetches do. A tarball gets
# no total bound: a large live transfer must be let finish.
: "${CCRC_RELEASE_CONNECT_TIMEOUT:=10}"
: "${CCRC_RELEASE_SPEED_LIMIT:=1024}"
: "${CCRC_RELEASE_SPEED_TIME:=30}"
: "${CCRC_RELEASE_SUMS_MAX_TIME:=20}"
: "${CCRC_RELEASE_SUMS_MAX_FILESIZE:=4096}"

# curl reads 0 (and a negative or non-numeric spelling) for each of these as "no
# limit" or an error, so a value is used only when it is a plain whole number
# from 1 to the updater's own ceiling; anything else falls back to the default
# with one warning line (the updater's `_upd_validate_timeout`, same sentence,
# on stderr here). The calls below repeat its arguments, and install-sh.test.ts
# reds when a default or a ceiling differs from the ones ccd/ccrc passes.
# Indirect read and `printf -v`: no eval, and both are bash 3.1+.
_inst_validate_knob() {
  local name="$1" default="$2" what="${3:-a whole number of seconds from 1 to 3600}" max="${4:-3600}" val LC_ALL=C
  val="${!name:-}"
  if [ -z "$val" ]; then return 0; fi
  if [[ "$val" =~ ^[1-9][0-9]{0,9}$ ]] && [ "$val" -le "$max" ]; then return 0; fi
  echo "install.sh: WARN: $name='${val//[![:print:]]/?}' is not $what — using $default" >&2
  printf -v "$name" '%s' "$default"
}
_inst_validate_knob CCRC_RELEASE_CONNECT_TIMEOUT 10
_inst_validate_knob CCRC_RELEASE_SPEED_LIMIT 1024 \
  'a whole number of bytes/second from 1 to 100000000' 100000000
_inst_validate_knob CCRC_RELEASE_SPEED_TIME 30
_inst_validate_knob CCRC_RELEASE_SUMS_MAX_TIME 20
_inst_validate_knob CCRC_RELEASE_SUMS_MAX_FILESIZE 4096 \
  'a whole number of bytes from 1 to 1048576' 1048576

# ── The URL redactor — a COPY of `_upd_redact` (ccd/ccrc), held equal by OUTPUT,
# not by text, under an install.sh-local name. It masks a URL's userinfo and the
# home directory; it does NOT mask a query or a fragment (accepted: the
# operator's ruling, shared with the updater). Why the text differs: this file
# runs `--release` BEFORE its bash version refusal, so the copy can run on
# macOS /bin/bash 3.2, where (as in every bash up to 4.2) a quoted replacement
# string inside "${s/pat/rep}" keeps its quotes and would print `https"://"h/r`;
# ccd/ccrc needs bash 4.4 and never meets that. So each replacement here is a
# first-occurrence cut-and-join (`${s%%"$m"*}$r${s#*"$m"}`) with no pattern
# substitution in it (an unquoted `$r` in a `${s/…/$r}` would also expand a `&`
# under bash 5.2). install-sh.test.ts runs both functions over the same inputs,
# the copy also under BASH_COMPAT=42, 40 and 32, and reds on any byte of difference.
_inst_redact() {
  local s="${1:-}" mode="${2:-}" LC_ALL=C cut="" m="" r=""
  if [ "${#s}" -gt 4096 ]; then
    local head="${s:0:4001}"
    if [[ "$head" =~ ^(.*)[[:space:]] ]]; then head="${BASH_REMATCH[1]}"; else head=""; fi
    cut="${head:+ }[cut: $(( ${#s} - ${#head} )) more bytes withheld, over the redactor's 4096-byte cap]"
    s="$head"
  fi
  local sre=':((\\?/)+)@*[^/@?#[:space:]]+@'; while [[ "$s" =~ $sre ]]; do m="${BASH_REMATCH[0]}"; r=":${BASH_REMATCH[1]}"; s="${s%%"$m"*}$r${s#*"$m"}"; done
  local kre='(^|[[:space:]"'"'"'<(])(-{0,2}[A-Za-z_][A-Za-z0-9_-]*=)([^:=/?#[:space:]"'"'"'<(][^/?#[:space:]]*(:|%3[Aa])[^/?#[:space:]]*@)'; while [[ "$s" =~ $kre ]]; do m="${BASH_REMATCH[0]}"; r="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"; s="${s%%"$m"*}$r${s#*"$m"}"; done
  local re='(^|[[:space:]"<`])((@*[^/@?#[:space:]"<`][^/@?#[:space:]]*@)([^/@?#[:space:]]*@)*)([^/@?#[:space:]]+[/?#])'; while [[ "$s" =~ $re ]]; do m="${BASH_REMATCH[0]}"; r="${BASH_REMATCH[1]}${BASH_REMATCH[5]}"; s="${s%%"$m"*}$r${s#*"$m"}"; done
  local cre='(^|[[:space:]"'"'"'<(])(([^/?#[:space:]"'"'"'<(][^/?#[:space:]]*)?(:|%3[Aa])[^/?#[:space:]]*@)'; while [[ "$s" =~ $cre ]]; do m="${BASH_REMATCH[0]}"; r="${BASH_REMATCH[1]}"; s="${s%%"$m"*}$r${s#*"$m"}"; done
  local ptre='(^|[[:space:]"'"'"'<(`])((@*[^/@?#[:space:]"'"'"'<(`][^/@?#[:space:]]*@)([^/@?#[:space:]]*@)*)(([^/@?#[:space:]:]*[^/@?#[:space:]:0-9][^/@?#[:space:]:]*|\[[0-9A-Za-z:.%_~-]+\]):[0-9]+([^0-9A-Za-z.!}_~-]|$|[.!}]+([^0-9A-Za-z.!}_~-]|$)))'; while [[ "$s" =~ $ptre ]]; do m="${BASH_REMATCH[0]}"; r="${BASH_REMATCH[1]}${BASH_REMATCH[5]}"; s="${s%%"$m"*}$r${s#*"$m"}"; done
  if [ "$mode" = bare-host ]; then
    local bre='(^|[[:space:]"<`])((@*[^/@?#[:space:]"<`][^/@?#[:space:]]*@)([^/@?#[:space:]]*@)*)([^/@?#[:space:])]+([/?#)]|$))'
    while [[ "$s" =~ $bre ]]; do m="${BASH_REMATCH[0]}"; r="${BASH_REMATCH[1]}${BASH_REMATCH[5]}"; s="${s%%"$m"*}$r${s#*"$m"}"; done
  fi
  local home="${HOME:-}"
  home="${home%/}"
  if [ -n "$home" ]; then
    local seen="" out="" pre="" post="" before="" after="" left=0 right=0
    while [[ "$s" == *"$home"* ]]; do
      pre="${s%%"$home"*}"
      post="${s#*"$home"}"
      seen+="$pre"
      before="${seen: -1}"
      after="${post:0:1}"
      left=0; right=0
      case "$before" in
        ''|' '|$'\t'|$'\n'|'"'|"'"|'`'|'='|':'|'('|'['|'{'|','|';'|'<'|'>'|'|') left=1 ;;
        '/') case "$seen" in *://) left=1 ;; esac ;;
      esac
      case "$after" in
        ''|'/'|' '|$'\t'|$'\n'|'"'|"'"|':'|')') right=1 ;;
      esac
      if [ "$left" -eq 1 ] && [ "$right" -eq 1 ]; then out+="${pre}~"; else out+="${pre}${home}"; fi
      seen+="$home"
      s="$post"
    done
    s="${out}${s}"
  fi
  s+="$cut"
  printf '%s' "$s"
}

# The tarball name SHA256SUMS supplies reaches `curl -o` before any checksum is
# checked, so it is held to a rule where it is read. Prints the rule broken (or
# nothing). The length test runs FIRST so a long value is never pattern-scanned;
# counted and matched under LC_ALL=C so "bytes" and "printable ASCII" mean bytes.
# A refusal built from this names the rule, never the raw name (it may carry a
# terminal escape).
_inst_name_refusal() {
  local n="$1" LC_ALL=C
  if [ "${#n}" -gt 128 ]; then echo "is ${#n} bytes, over the 128-byte limit"; return 0; fi
  if [[ "$n" == *[^[:print:]]* ]]; then echo "is not printable ASCII"; return 0; fi
  case "$n" in
    */*) echo "has a path separator"; return 0 ;;
    *..*) echo 'has a ".."'; return 0 ;;
    ccrc-*.tar.gz) ;;
    *) echo "is no ccrc tarball (names no ccrc-*.tar.gz)"; return 0 ;;
  esac
  return 0
}

usage() { echo "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)"; }

# `cmd_install`'s own loop (ccd/ccrc:1730-1735), one layer up: an install that
# half-ran because argument 2 was a typo is worse than one that did not
# start, and install.sh is now the OUTERMOST entry point a new operator
# types — so it must refuse an argument it does not understand rather than
# silently discard it and run a full install anyway. `--release` breaks out:
# every later argument belongs to the staged `ccrc install`, whose own loop
# applies the same discipline one layer down.
RELEASE_MODE=false
RELEASE_TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --release)
      RELEASE_MODE=true; shift
      if [ $# -gt 0 ] && [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then RELEASE_TAG="$1"; shift; fi
      break ;;
    *) echo "install.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$RELEASE_MODE" = true ]; then
  command -v curl >/dev/null 2>&1 \
    || { echo "install.sh: curl is not installed — install curl, then re-run" >&2; exit 1; }
  BASE="${CCRC_RELEASE_BASE_URL:-https://github.com/$CCRC_RELEASE_OWNER/$CCRC_RELEASE_REPO/releases}"
  if [ -n "$RELEASE_TAG" ]; then URL_DIR="$BASE/download/$RELEASE_TAG"; else URL_DIR="$BASE/latest/download"; fi

  # AN EXPLICIT TEMPLATE, because BSD `mktemp` IGNORES `$TMPDIR` when given
  # none — measured: macOS answers inside its own per-user Darwin temp dir
  # while GNU honours the variable. This is the directory a release tarball is
  # downloaded and extracted into, so an operator who points TMPDIR at a volume
  # with room, or at a directory they control, must not be silently overruled.
  STAGING="$(mktemp -d "${TMPDIR:-/tmp}/ccrc.XXXXXXXXXX")"
  # `|| :` — the fixture harness PATH may lack rm; a failed cleanup must
  # never override the refusal's own exit code (set -e in an EXIT trap does).
  trap 'rm -rf "$STAGING" 2>/dev/null || :' EXIT
  # Every refusal below exits through this trap, so a failed or TAMPERED
  # download never lingers in /tmp; the success path disarms it right before
  # the exec — the staged tree must outlive install.sh exactly then.
  # `|| :` — the fixture harness PATH may lack rm; a failed cleanup must
  # never override the refusal's own exit code (set -e in an EXIT trap does).
  # SHA256SUMS first: under `latest/` the tag is unknown until the sums file
  # names the tarball. A missing release is curl's own failure, surfaced —
  # `-f` turns the 404 into exit 22 and the message below names the URL.
  URL_SAFE="$(_inst_redact "$URL_DIR")"
  # `-g` on every release curl: curl expands `{…}` and `[…]` before it parses a
  # URL, so a base spelled `http:{/}/u:p@h` would authenticate while the line
  # below printed it whole; with globbing off curl refuses it before a byte is
  # sent, and a tarball name is never globbed (the updater's D-6748).
  echo "install.sh: fetching $URL_SAFE/SHA256SUMS …"
  curl -g -fsSL --connect-timeout "$CCRC_RELEASE_CONNECT_TIMEOUT" \
    --max-time "$CCRC_RELEASE_SUMS_MAX_TIME" --max-filesize "$CCRC_RELEASE_SUMS_MAX_FILESIZE" \
    --speed-limit "$CCRC_RELEASE_SPEED_LIMIT" --speed-time "$CCRC_RELEASE_SPEED_TIME" \
    -o "$STAGING/SHA256SUMS" "$URL_DIR/SHA256SUMS" \
    || { echo "install.sh: download failed: $URL_SAFE/SHA256SUMS (is there a release, or did the connection stall or time out?)" >&2; exit 1; }
  read -r _sum TARNAME < "$STAGING/SHA256SUMS" \
    || { echo "install.sh: SHA256SUMS is empty — refusing" >&2; exit 1; }
  # The sha256sum binary-mode marker (`<digest> *<name>`) is the line format's,
  # not part of the name: it goes FIRST, so the rules below judge (and count)
  # the name itself. It is a one-character prefix strip, cheap on any length.
  TARNAME="${TARNAME#\*}"
  NAME_RULE="$(_inst_name_refusal "$TARNAME")"
  if [ -n "$NAME_RULE" ]; then
    echo "install.sh: SHA256SUMS's tarball name $NAME_RULE — refusing" >&2; exit 1
  fi
  echo "install.sh: fetching $URL_SAFE/$TARNAME …"
  curl -g -fsSL --connect-timeout "$CCRC_RELEASE_CONNECT_TIMEOUT" \
    --speed-limit "$CCRC_RELEASE_SPEED_LIMIT" --speed-time "$CCRC_RELEASE_SPEED_TIME" \
    -o "$STAGING/$TARNAME" "$URL_DIR/$TARNAME" \
    || { echo "install.sh: download failed: $URL_SAFE/$TARNAME (did the connection stall — under ${CCRC_RELEASE_SPEED_LIMIT}B/s for ${CCRC_RELEASE_SPEED_TIME}s?)" >&2; exit 1; }

  # Verify BEFORE extracting: a tarball that fails its checksum never gets
  # to put a single file on disk, let alone run one.
  #
  # THE DIGEST TOOL IS CHOSEN BY PLATFORM, the same two-line shim
  # `deploy/build-release.sh` uses (BR_SHA256), because this file is the
  # bootstrap and can source nothing: `_plat_sha256_check` lives inside the
  # tarball that has not been verified yet. `sha256sum` is GNU coreutils and
  # macOS does not ship it — and because the check swallows its own stderr,
  # a missing tool exits the subshell 127 and lands in the `||` arm: the
  # first thing a macOS operator ever saw from ccrc was a FABRICATED
  # supply-chain accusation about an intact download. `shasum -a 256 -c`
  # reads the GNU-written two-space SHA256SUMS unchanged (measured against
  # the published release). Unquoted on use, so the two words split.
  SUM=sha256sum
  [ "$(uname -s 2>/dev/null)" = Darwin ] && SUM="shasum -a 256"
  ( cd "$STAGING" && $SUM -c SHA256SUMS >/dev/null 2>&1 ) \
    || { echo "install.sh: checksum verification FAILED for $TARNAME — refusing to extract or install" >&2; exit 1; }

  mkdir "$STAGING/tree"
  tar -xzf "$STAGING/$TARNAME" -C "$STAGING/tree"
  echo "install.sh: verified $TARNAME — handing off to the staged 'ccrc install'"
  # TRUST ON FIRST USE, said out loud (design 2026-09-20 §5): this bootstrap
  # has no installed verifier to use and must not use the one it just
  # downloaded (self-attestation). The tree it places carries the verifier;
  # every `ccrc update` from here verifies provenance before extracting.
  echo "install.sh: first install trusts the release's transport checksum only; every update from here verifies provenance"
  trap - EXIT
  # M6 (W1 minor): CCRC_UPDATE_VERIFIED is `cmd_update`'s word to the spine
  # that it VERIFIED this tree's provenance — `_inst_installed` reads it and
  # nothing else to decide the marker's line 2. This bootstrap verified
  # nothing (trust on first use, said above), so an export left in the
  # caller's shell must never reach the verb. A builtin, not `env -u`: this
  # script runs on a bare box and names no tool it does not need.
  unset CCRC_UPDATE_VERIFIED
  exec bash "$STAGING/tree/ccd/ccrc" install "$@"
fi

# ── macOS PREFLIGHT, BEFORE THE BUILD ────────────────────────────────────
# `ccrc install` checks these too, and checks them again for a reason — it is
# also reached from `--release`, which never runs this file's build. But this
# script is the documented entry point, and the two minutes of `npm ci` and a
# vite build sit between here and there: a box that cannot run ccd should
# learn it now, not after paying for a bundle it will not use.
#
# AND THIS SCRIPT IS THE ONLY PLACE THE BASH CHECK CAN LIVE AT ALL. macOS
# ships bash 3.2.57 (2007, GPLv2) as /bin/bash, and `ccd` needs 4.4+ — it uses
# `local -A`, `[[ -v arr[k] ]]`, `mapfile`, BASHPID, and (the fact that sets
# the floor at 4.4, not 4.2) empty-array "${a[@]}" expansions under `set -u`,
# which bash treated as a fatal unbound variable until 4.4 relaxed it. A 3.2
# box running `ccd` gets a SYNTAX ERROR at a line number, mid-session, after
# a pane has already been started; a 4.2/4.3 box dies at the first empty
# array instead. install.sh itself is deliberately written to the 3.2
# subset so that this refusal is the thing that runs.
if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
  bmaj="${BASH_VERSINFO[0]:-0}"; bmin="${BASH_VERSINFO[1]:-0}"
  if [ "$bmaj" -lt 4 ] || { [ "$bmaj" -eq 4 ] && [ "$bmin" -lt 4 ]; }; then
    echo "install.sh: bash $bmaj.$bmin is too old — ccd needs 4.4 or newer, and macOS ships 3.2.57 as /bin/bash for licensing reasons." >&2
    echo "install.sh: fix it with:  brew install bash    (then make sure /opt/homebrew/bin comes before /bin on PATH, and re-run this script)" >&2
    exit 1
  fi
  for t in tmux flock; do
    command -v "$t" >/dev/null 2>&1 || {
      echo "install.sh: $t is required by ccrc and macOS does not ship it — install it: brew install $t" >&2
      exit 1
    }
  done
fi

command -v node >/dev/null 2>&1 || { echo "install.sh: node is not installed — install Node (nodesource or nvm), then re-run" >&2; exit 1; }
# The floor is READ from the shipped package.json — never a second copy
# (node-floor.test.ts pins all three identical). Without node:sqlite the server
# will not boot; without its FTS5 ccrc history captures unsearched (fts5-absent; D-4296).
floor="$(node -e 'process.stdout.write(require(process.argv[1]).engines.node)' "$ROOT/server/package.json" 2>/dev/null)" \
  || { echo "install.sh: cannot read engines.node from $ROOT/server/package.json — is this a complete checkout?" >&2; exit 1; }
node -e '
const floor = process.argv[1].replace(/^>=/,"").trim();
const cur = process.versions.node;
const at = s => s.split(".").map(Number);
const [a,b,c] = at(cur), [x,y,z] = at(floor);
const ok = a>x || (a===x && (b>y || (b===y && c>=z)));
if (!ok) { console.error(`install.sh: node ${cur} is below the required ${floor}`); process.exit(1); }
' "$floor" || exit 1

echo "install.sh: building (server deps, PWA bundle, server dist)…"
( cd "$ROOT/server" && npm ci --no-audit --no-fund )
# ui is installed, not built, and before pwa: pwa builds @ccrc/ui from SOURCE
# (`file:../ui`), whose imports resolve from ui/node_modules alone, so a fresh
# checkout fails the PWA build without it (deploy/build-release.sh says why).
( cd "$ROOT/ui" && npm ci --no-audit --no-fund )
( cd "$ROOT/pwa" && npm ci --no-audit --no-fund && npm run build )
( cd "$ROOT/server" && npm run build )
# D-1159: the agent is the FOURTH artifact `ccrc install` refuses without, for
# every role but `server` — `ccrc-agent.service` runs
# `agent/dist/agent/src/index.js`. It is built unconditionally here because this
# script does not know the role: `--role` rides on the staged verb, and for a
# source install it is not passed at all (the verb's own default is `both`,
# which needs an agent). Building it for a server-only box costs one tsc run;
# NOT building it cost a live fleet its agent.
( cd "$ROOT/agent" && npm ci --no-audit --no-fund && npm run build )

# M6: a checkout install verified nothing either — the release arm's rule,
# said there.
unset CCRC_UPDATE_VERIFIED
exec bash "$ROOT/ccd/ccrc" install
