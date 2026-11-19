
def SQ: $q + "[^" + $q + "]*" + $q;
def AQ: "\\$" + $q + "(?>(?:[^\\\\" + $q + "]++|\\\\(?:.|\\n|\\z))*)(?:" + $q + "|(?<ua>\\z))";
def W: "[^\\s;&|()<>\"" + $q + "\\\\]+";
def T($n; $tabs; $end): $tabs + "\\k<w\($n)>" + $end;
def hd1($n; $tabs; $end):
  "(?:(?<q\($n)>[\"" + $q + "])|\\\\?)(?<w\($n)>(?(<q\($n)>)[^\"" + $q + "\\n]+|" + W + "))(?(<q\($n)>)\\k<q\($n)>)"
  + "(?![^\\n]*?(?<!<)<<(?!<))(?>[^\\n]*)(?:\\n|\\z)"
  + "(?>(?:(?!" + T($n; $tabs; $end) + ")[^\\n]*\\n)*(?:(?!" + T($n; $tabs; $end) + ")[^\\n]++)?)(?:" + T($n; $tabs; $end) + ")?";
def AR: "(?>(?:[^()\\n]++|\\((?>(?:[^()\\n]++|\\([^()\\n]*+\\))*)\\))*)";
def DEFS:
  "(?<hd>(?<!<)<<(?:-[ \\t]*" + hd1("t"; "\\t*"; "(?![^\\n])") + "|[ \\t]*" + hd1(""; ""; "(?![^\\n])") + ")){0}"
  + "(?<hs>(?<!<)<<(?:-[ \\t]*" + hd1("st"; "\\t*"; "(?![^\\n)])") + "|[ \\t]*" + hd1("s"; ""; "(?![^\\n)])") + ")){0}"
  + "(?<sub>\\$\\(\\(" + AR + "\\)\\)|\\$\\((?<sb>(?>(?:[^" + $q + "\"()\\\\<#$]++|\\$\\$|" + AQ + "|\\g<pe>|\\$|\\\\(?:.|\\n|\\z)[^\\s;&|()<>\"" + $q + "`\\\\$]*|\\g<hs>|(?<!<)<<(?!<)[\\s\\S]*|<|(?<![^\\s;&|(])#[^\\n]*|#|" + $q + "[^" + $q + "]*+(?:" + $q + "|\\z)|\\g<dq>|\\(\\(" + AR + "\\)\\)|\\(\\g<sb>(?:\\)|\\z))*))(?:\\)|(?<us>\\z))){0}"
  + "(?<pe>\\$\\{(?>(?:[^}\"" + $q + "\\\\$`]++|\\\\(?:.|\\n|\\z)|\\g<dq>|\\$\\$|" + AQ + "|" + $q + "[^" + $q + "]*+(?:" + $q + "|\\z)|\\g<sub>|\\g<pe>|`(?>(?:[^`\\\\]++|\\\\(?:.|\\n))*)`|`|\\$(?![({]))*)(?:\\}|\\z)){0}"
  + "(?<dq>\"(?>(?:[^\"\\\\$`]++|\\\\(?:.|\\n|\\z)|\\g<pe>|\\$(?![({])|\\g<sub>|`(?>(?:[^`\\\\]++|\\\\(?:.|\\n))*)`|`)*)(?:\"|(?<ud>\\z))){0}";
def fs(re; f): . as $in | [match(re; "g") | [.offset, .length, .string, any(.captures[]; (.name == "us" or .name == "ud" or .name == "ua") and .string != null)]] as $ms
  | if ($ms | length) == 0 then $in else ($in | explode) as $cp
    | [range(0; $ms | length) as $i | $ms[$i] as $m
       | (if $i == 0 then 0 else $ms[$i - 1] | .[0] + .[1] end) as $p
       | ($cp[$p:$m[0]] | implode), ($m[2:4] | f)] as $parts
    | ($parts | map(. == null) | index(true)) as $stop
    | if $stop == null then $parts + [$cp[($ms[-1] | .[0] + .[1]):] | implode] | add
      else ($parts[0:$stop] | add // "") + ($cp[$ms[($stop - 1) / 2][0]:] | implode) end end;
def plain: . as $s | all(($q, "\"", "\\", "#", "<", "`", "((", "$["); . as $c | $s | contains($c) | not);
def qs($h):
  def subs: if contains("$(") | not then ""
    elif startswith("$(") and endswith(")") and (.[2:-1] | plain and (contains("(") or contains(")") or contains("$") | not)) then .
    else fs(DEFS + "\\\\(?:.|\\n)|\\g<sub>|[^\\\\$]+|\\$";
      .[1] as $open | .[0] | if (startswith("$(") | not) then "" elif $open then . elif startswith("$((") then . else "$(" + (.[2:-1] | qs(true)) + ")" end) end;
  if plain then . else fs(DEFS + "\\\\.[^\\s;&|()<>\"" + $q + "`\\\\$]*|\\$\\$|" + AQ + "|" + SQ + "|\\g<dq>|" + (if $h then "\\g<hd>|(?<!<)<<(?!<)|" else "" end) + "(?<![^\\s;&|(])#[^\\n]*|\\$?\\(\\(" + AR + "\\)\\)|\\$\\[[^\\]\\n]*\\]";
    .[1] as $open | .[0] | if $open then .
    elif startswith("\"") then .[1:-1] | subs
    elif . == "<<" then null
    elif startswith("<<") then (split("\n") | last) as $last
      | [capture("^<<(?<d>-?)[ \\t]*(?:(?<q>[\"" + $q + "])(?<w>[^\"" + $q + "\\n]+)\\k<q>|(?<x>\\\\?)(?<w2>" + W + "))(?<r>[^\\n]*)(?<b>[\\s\\S]*)")] | if length == 0 then null else .[0]
      | (.r | qs(false)) as $rest
      | ((.b | contains("\n")) and (if .d == "-" then $last | sub("^\\t+"; "") else $last end) == (.w // .w2)
         and ($rest | contains("\"") or contains($q) or contains("`") | not)
         and (((.w // .w2) + ")") as $wp | (.d == "-") as $dash
             | .b | split("\n") | any(if $dash then sub("^\\t+"; "") else . end | startswith($wp)) | not)) as $done
      | if $done | not then null else "<<" + $rest + "\n" + (if .x == "" and .q == null then .b | subs else "" end) end end
    elif startswith("$((") or startswith("((") or startswith("$[") or startswith("$$") then .
    else "" end) end;
def ocsegs: reduce (";", "&", "|", "\n") as $s ([.]; map(split($s)) | add);
def ocafter($re): . as $s | [match($re)] | if length == 0 then empty else $s[.[0].offset + .[0].length:] end;
def ocmerge: ocafter("(^|[^A-Za-z0-9_])gh(?=\\s)") | ocafter("\\spr(?=\\s|$)") | ocafter("\\smerge($|[\\s`()<>])");
def ocwords: contains("gh") and contains("merge")
  and any(ocsegs[] | select(contains("gh") and contains("merge")) | ocmerge; true);
def ocapi: ocafter("(^|[^A-Za-z0-9_])gh(?=\\s)") | ocafter("\\sapi($|[\\s`()<>])");
def MUT: ["mergePullRequest", "enqueuePullRequest", "enablePullRequestAutoMerge", "mergeBranch"];
def mutword: . as $s | any(MUT[]; . as $w | $s | contains($w));
def unq: split($q) | join("") | split("\"") | join("") | split("\\") | join("");
def ocapiwords: contains("gh") and contains("api")
  and ((unq) as $u | ($u | mutword) or ($u | contains("/merge")))
  and any(ocsegs[] | select(contains("gh") and contains("api")) | ocapi; true);
def ockinds: (ocwords) as $m | (ocapiwords) as $a
  | [(if $m then "merge" else empty end), (if $m and contains("--admin") then "admin" else empty end), (if $a then "api" else empty end)] | join(",");
def mergepath: "pulls/[^[:space:]/]++/merge(?![A-Za-z0-9_-])|repos/[^[:space:]/]++/[^[:space:]/]++/merges(?![A-Za-z0-9_-])|pulls/[^;&|\\n/]++/merge(?![A-Za-z0-9_-])|repos/[^;&|\\n/]++/[^;&|\\n/]++/merges(?![A-Za-z0-9_-])";
def vflags: (unq) as $u | (if contains("--admin") then "a" else "" end) + (if test($allow) then "s" else "" end)
  + (if ($u | mutword) then "w" else "" end) + (if ($u | test(mergepath)) then "p" else "" end);
def capped(f): (.tool_input.command // "") as $c
  | if ($c | type) == "string" and ($c | utf8bytelength) > $cap
    then ($c | ockinds) as $k | (if $k == "" then "" else "!\($c | utf8bytelength):\($k)" end)
    else "=" + ($c | vflags) + "\u001f" + f end;
capped(if .tool_name == "Bash" then ((.tool_input.command // "") | qs(true)) else "" end)