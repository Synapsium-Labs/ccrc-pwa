#!/usr/bin/env bash
# Regenerates the guard goldens: what real jq prints for MERGE_STRIP_JQ and APPROVAL_FORBIDDEN_JQ, each cut from
# ccd/session-hook.sh (cut-hook-assign.mjs) and run as the hook runs it (`--arg q "'"`, the strip with `--argjson cap
# MERGE_PARSE_CAP --arg allow ALLOW_ADMIN_RE`, the forbidden program in each `--arg mode` and, in deny mode, with no deny
# file, the box's file as the installer writes it, and that file with an upstream id; HOME=/home/u), over every payload
# of guard-cases.jsonl (gen-guard-cases.mjs) and, for the deny file's own parse, over deny-texts.jsonl crossed with a
# few commands. One line per case and run: `[<the one output>]` as JSON, or "ERR" where jq failed (the hook's `|| x=""`).
# guard_test.go holds attention.MergeStrip and attention.Forbidden to them and guard-programs.sha256 pins the two
# programs, so a change to either is red there. Run from anywhere with the jq to measure first on PATH (JQ=… to pick one;
# on Windows a native jq needs -b, which JQFLAGS carries). Made on the Linux bench (jq 1.7) and checked on jq 1.8.
set -euo pipefail
cd "$(dirname "$0")"
JQ=${JQ:-jq}
JQFLAGS=${JQFLAGS:-}
OUT=${OUT:-.} # where the goldens go (a second jq's run writes elsewhere and is compared)
hook=../../../../../ccd/session-hook.sh
strip=$(node cut-hook-assign.mjs "$hook" MERGE_STRIP_JQ)
forb=$(node cut-hook-assign.mjs "$hook" APPROVAL_FORBIDDEN_JQ)
allow=$(node cut-hook-assign.mjs "$hook" ALLOW_ADMIN_RE)
cap=$(grep -m1 '^MERGE_PARSE_CAP=' "$hook"); cap=${cap#*=}
node gen-guard-cases.mjs > "$OUT/guard-cases.jsonl"
# the deny file as the installer writes it (childDenyRules, from the vocabulary), and with an upstream id beside claude
denyfile() {
  node -e '
const s=require("fs").readFileSync("../../../kernel/vocab/vocab_gen.go","utf8");
const b=/var ChildDenyRules = \[\]string\{([\s\S]*?)\n\}/.exec(s)[1];
const rules=[...b.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m=>JSON.parse(`"${m[1]}"`));
const extra=process.argv[1]==="u"?["Bash(upx install:*)","Bash(upx update:*)","Bash(lane-q install:*)"]:[];
process.stdout.write(JSON.stringify({permissions:{deny:rules.concat(extra)}},null,2)+"\n");' "$1"
}
deny_c=$(denyfile c; printf x); deny_c=${deny_c%x} # the file's text, its last newline kept, as the hook reads it
deny_u=$(denyfile u; printf x); deny_u=${deny_u%x}
printf '%s' "$deny_c" > "$OUT/guard-deny-c.json"
printf '%s' "$deny_u" > "$OUT/guard-deny-u.json"
run() { # <out> <program> <jq args…>
  local out=$1 prog=$2; shift 2
  HOME=/home/u "$JQ" $JQFLAGS -n -r --arg q "'" "$@" "def prog: $prog; inputs | try ([prog] | tojson) catch \"ERR\"" "$OUT/guard-cases.jsonl" > "$out"
}
run "$OUT/guard-strip.golden" "$strip" --argjson cap "$cap" --arg allow "$allow"
# the mail hold's strip: the module's mh_prep, then the strip, in one jq, as the hook composes them; and mh_prep's own
# answer (`-c`), which the Go hook asks jq for and hands to MergeStrip
lib=../../../../../ccd/lib
"$JQ" $JQFLAGS -n -c -L "$lib" 'include "mail-hold"; inputs | try mh_prep catch null' "$OUT/guard-cases.jsonl" > "$OUT/guard-prep.jsonl"
HOME=/home/u "$JQ" $JQFLAGS -n -r -L "$lib" --arg q "'" --argjson cap "$cap" --arg allow "$allow" \
  "include \"mail-hold\"; def prog: $strip; inputs | try ([mh_prep | prog] | tojson) catch \"ERR\"" "$OUT/guard-cases.jsonl" > "$OUT/guard-mhstrip.golden"
run "$OUT/guard-class.golden" "$forb" --arg mode class
run "$OUT/guard-account.golden" "$forb" --arg mode account
run "$OUT/guard-deny.golden" "$forb" --arg mode deny
run "$OUT/guard-denyc.golden" "$forb" --arg mode deny --arg deny "$deny_c"
run "$OUT/guard-denyu.golden" "$forb" --arg mode deny --arg deny "$deny_u"
# HOME unset: pnorm's `$ENV.HOME // "~"`, over the path rows only (a `~/` path)
grep -F '"~/' "$OUT/guard-cases.jsonl" | grep -v '"Bash"' > "$OUT/guard-nohome-cases.jsonl" || true
env -u HOME "$JQ" $JQFLAGS -n -r --arg q "'" --arg mode deny "def prog: $forb; inputs | try ([prog] | tojson) catch \"ERR\"" "$OUT/guard-nohome-cases.jsonl" > "$OUT/guard-nohome.golden"
# the deny file's parse: each text of deny-texts.jsonl (gen-guard-deny-texts.mjs) as `--arg deny`, over a few commands
node gen-guard-deny-texts.mjs > "$OUT/guard-deny-texts.jsonl"
: > "$OUT/guard-denytext.golden"
while IFS= read -r t; do
  d=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]))' "$t"; printf x); d=${d%x}
  HOME=/home/u "$JQ" $JQFLAGS -n -r --arg q "'" --arg mode deny --arg deny "$d" \
    "def prog: $forb; [\"upx install\", \"~/.local/bin/upx update\", \"lane-q install\", \"x-y update\", \"claude update\", \"cp a ~/.local/bin/upx\", \"cp a ~/.local/bin/x-y\"][] | {tool_name: \"Bash\", tool_input: {command: .}} | try ([prog] | tojson) catch \"ERR\"" >> "$OUT/guard-denytext.golden"
done < "$OUT/guard-deny-texts.jsonl"
# pmglob's regex, built from the command's own text: the program's g2re and PMNS (cut from it), each glob word of
# guard-globs.jsonl (gen-guard-globs.mjs) turned into a pattern and tested whole against each name, "err" where
# Oniguruma refuses the pattern: `[<g2re's output>, <five answers>]`
defs=$(node -e '
const s=require("fs").readFileSync(0,"utf8");
const pick=(n)=>{const m=new RegExp("^def "+n+":[\\s\\S]*?;$","m").exec(s);if(!m)throw new Error(n);return m[0];};
process.stdout.write(pick("PMNS")+"\n"+pick("g2re")+"\n");' <<<"$forb")
node gen-guard-globs.mjs > "$OUT/guard-globs.jsonl"
"$JQ" $JQFLAGS -n -c "$defs"' inputs | g2re as $r | [$r] + [PMNS[] | try (test("^(?:" + $r + ")$") | tostring) catch "err"]' \
  "$OUT/guard-globs.jsonl" > "$OUT/guard-globs.golden"
# the retry-limit sweep (review F9): the same answers, over many-star words, where Oniguruma's retry limit is an `err`
node gen-guard-retry.mjs > "$OUT/guard-retry.jsonl"
"$JQ" $JQFLAGS -n -c "$defs"' inputs | g2re as $r | [$r] + [PMNS[] | try (test("^(?:" + $r + ")$") | tostring) catch "err"]' \
  "$OUT/guard-retry.jsonl" > "$OUT/guard-retry.golden"
{ printf '%s' "$strip" | sha256sum | cut -d' ' -f1; printf '%s' "$forb" | sha256sum | cut -d' ' -f1; printf '%s' "$allow" | sha256sum | cut -d' ' -f1; } > "$OUT/guard-programs.sha256"
wc -l "$OUT"/guard-cases.jsonl "$OUT"/guard-*.golden
