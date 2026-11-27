def WS: "\t\n\u000b\f\r " + ([160, 5760, 8192, 45, 8202, 8232, 8233, 8239, 8287, 12288, 65279] | implode);
def SP: "[" + WS + "]"; def NS: "[^" + WS + "]";
def WB: "(?:^|" + SP + "|[;&|()`" + $q + "\"=/])";
def NW: "(?![A-Za-z0-9_-])";
def NB: "(?<![A-Za-z0-9_])";
def NA: "(?![A-Za-z0-9_])";
def FLAGS: "(?:-" + NS + "+" + SP + "+)*";
def CCD: WB + "ccd[" + $q + "\"]?" + SP + "+" + FLAGS;
def ACCTV: "add", "auth-start", "auth-code", "auth-cancel", "set", "check", "enable", "disable", "credential", "remove", "seed", "openrouter-management";
def AAUTH: "(?:(?:^|[" + WS + ";&|()`" + $q + "\"=])|/\\.local/bin/)ccd-account-auth(?![A-Za-z0-9_.-])";
def SENS: "(?:CLAUDE\\.md|settings(?:\\.local)?\\.json|session-hook\\.sh|/hooks/)";
def CRED: "(?:\\.ssh(?![A-Za-z0-9_-])|\\.cc-secrets|\\.token(?![A-Za-z0-9_-])|\\.env(?:rc|\\.[A-Za-z0-9_.-]+)?(?![A-Za-z0-9_-])|credentials|auth\\.json|\\.netrc|\\.pem(?![A-Za-z0-9_-])|\\.key(?![A-Za-z0-9_.-])|agent\\.env|gh/(?:hosts|config)\\.yml|\\.docker/config\\.json|\\.kube/config(?![A-Za-z0-9_-])|\\.npmrc|\\.pypirc|\\.git-credentials|(?<![A-Za-z0-9_-])\\.aws(?![A-Za-z0-9_-])|(?<![A-Za-z0-9_-])\\.gnupg(?![A-Za-z0-9_-])|\\.config/gcloud(?![A-Za-z0-9_-])|_(?:rsa|dsa|ecdsa|ed25519)(?![A-Za-z0-9_-])|deploy_key|(?<![A-Za-z0-9_.-])identity(?![A-Za-z0-9_.-])|ssh_host_|\\.pgpass|\\.vault-token|rclone\\.conf|\\.s3cfg|(?<![A-Za-z0-9_-])\\.azure(?![A-Za-z0-9_-])|\\.git/config(?![A-Za-z0-9_-])|\\.claude\\.json|(?<![A-Za-z0-9_-])secrets?\\.(?:ya?ml|json|toml)(?![A-Za-z0-9_-])|_(?:ecdsa|ed25519)_sk(?![A-Za-z0-9_-])|\\.(?:p12|pfx|jks|keystore)(?![A-Za-z0-9_-])|\\.htpasswd|\\.my\\.cnf|kubeconfig|\\.tfstate|(?<![A-Za-z0-9_-])\\.boto(?![A-Za-z0-9_-])|service[-_]account[A-Za-z0-9_-]*\\.json|token\\.json(?![A-Za-z0-9_-])|\\.yarnrc\\.yml)";
def PATHF: "/\\.(?:cc-sessions|cc-limits|ccrc)(?![A-Za-z0-9_.-])|approval-signing|approval-verify\\.mjs";
def WR: ">|" + NB + "tee" + NA + "|" + NB + "sed" + SP + "+" + FLAGS + "-i|" + NB + "perl" + SP + "+-" + NS + "*i|" + NB + "mv" + NA + "|" + NB + "cp" + NA + "|" + NB + "ln" + NA + "|" + NB + "truncate" + NA + "|" + NB + "rm" + NA;
def BUILD: "(?:/\\.local/share/claude/versions(?![A-Za-z0-9_.-])|/\\.local/bin/claude(?![A-Za-z0-9_.-]))";
def hbt($sep; $head; $tail): any(split($sep; null)[];
  ([match("^[\\s\\S]*(?=" + $tail + ")")] | if length == 0 then -1 else .[0].length end) as $last
  | $last >= 0 and (.[0:$last] | test($head)));
def fmatch:
  (("ws-rm", "ws-reap", "ws-archive", "ws-restore", "ws-reclaim", "ws-expire", "ws-collect", "ws-orphan", "scratch-rescue", "ws-shed-deps", "keep-awake", "ws-lease-mark", "delegation-adopt", "docs-folder", "roll", "claude") as $v
     | select(test(CCD + $v + NW)) | "verb\tccd \($v)"),
  (select(hbt("[;&|]"; CCD + "ws-gc(?=" + SP + "|$)"; SP + "--prune" + NW)) | "verb\tccd ws-gc --prune"),
  (select(test(WB + "tmux(?=$|" + SP + "|[;&|)" + $q + "\"])")) | "other\ttmux"),
  (select(test("/\\.(?:cc-sessions|cc-limits|ccrc)(?![A-Za-z0-9_.-])")) | "other\ta registry path"),
  (select(test(WB + "(?:reboot|shutdown|poweroff|halt)(?=$|" + SP + "|[;&|)" + $q + "\"])")) | "other\treboot or shutdown"),
  (select(test(WB + "ccrc[" + $q + "\"]?" + SP + "+" + FLAGS + "(?:update|rollback|rollout)" + NW)) | "verb\tccrc update, rollback or rollout"),
  (ACCTV as $v | select(test(WB + "ccrc[" + $q + "\"]?" + SP + "+" + FLAGS + "account" + SP + "+" + FLAGS + $v + NW)) | "account\tccrc account \($v)"),
  (select(test(CCD + "account-pane" + NW)) | "account\tccd account-pane"),
  (select(test(AAUTH)) | "account\tccd-account-auth"),
  (select(test("(?:ccrc-api|\\$\\{?API\\}?)[" + $q + "\"]?" + SP + "+" + FLAGS + "approvals" + NW + "|/api/approvals" + NW + "|/api/questions/approval-|approval-signing|approval-verify\\.mjs")) | "surface\tthe approval surface"),
  (select(hbt("\n"; WB + "(?:systemctl|systemd-run|kill|pkill|killall)" + NW; "claude-session@|ccrc|tmux")) | "other\ta session unit or the tmux scope"),
  (select(hbt("[\n;&|]"; WR; SENS)) | "other\tan edit to a settings file, a hook or a CLAUDE.md"),
  (select(hbt("[\n;&|]"; WR; BUILD)) | "other\ta write to a Claude Code build or its launcher"),
  (select(hbt("[\n;&|]"; WB + "(?:cat|head|tail|less|more|base64|xxd|strings|od|nl|bat)" + NW; CRED)) | "other\tprinting a secret");
def norm: gsub("\\\\\n"; "") | gsub("\\$(?=[" + $q + "\"])"; "") | gsub("\\\\(?<c>[\\s\\S])"; .c) | gsub("[" + $q + "\"]"; "");
def GVAL: "(?:\\$\\([^()\n]*\\)|`[^`\n]*`|" + $q + "[^" + $q + "]*" + $q + "|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|\\\\[\\s\\S]|[^" + WS + "`$" + $q + "\"\\\\;|&]|\\$(?!\\())+";
def GITPRE: "(?:^|\\$\\(|[(`{])" + SP + "*(?:(?:then|do|else|elif|if|while|until|!)" + SP + "+){0,4}(?:[A-Za-z_][A-Za-z0-9_]*=(?:" + GVAL + ")?" + SP + "+){0,8}(?:(?:" + NS + "{0,256}/)?(?:sudo|env|command|exec|nohup|nice|time|timeout|bash|sh|zsh|dash)" + SP + "+(?:(?:-[A-Za-z]*[oO]" + SP + "+" + GVAL + "|-" + NS + "*|[A-Za-z_][A-Za-z0-9_]*=(?:" + GVAL + ")?|[0-9][0-9.]*[smhd]?)" + SP + "+){0,8}){0,4}(?:" + NS + "{0,256}/)?git" + SP + "+";
def GOPT: "(?:-[Cc]" + SP + "+" + GVAL + "|--(?:git-dir|work-tree|namespace|config-env|attr-source)(?:=(?:" + GVAL + ")?|" + SP + "+" + GVAL + ")|--exec-path(?:=(?:" + GVAL + ")?)?|--(?:no-pager|paginate|bare|no-replace-objects|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-optional-locks|no-lazy-fetch|no-advice)|-[pP])" + SP + "+";
def GITWT: GITPRE + "(?:" + GOPT + "){0,8}worktree" + SP + "+" + FLAGS + "prune" + NW + "(?<rest>[^#]*)";
def GLAST: "^[\\s\\S]*(?:^|" + SP + ")(?<f>-n|--dry-run|--no-d(?:r(?:y(?:-(?:r(?:u(?:n)?)?)?)?)?)?)(?=$|" + SP + "|[)])";
def QCH: "[" + $q + "\"\\\\$\n]*";
def WANC: "w" + QCH + "o" + QCH + "r" + QCH + "k" + QCH + "t" + QCH + "r" + QCH + "e" + QCH + "e";
def PANC: "p[" + $q + "\"\\\\$\n]*r[" + $q + "\"\\\\$\n]*u[" + $q + "\"\\\\$\n]*n[" + $q + "\"\\\\$\n]*e";
def QSEP: "[" + WS + ";&|()<>`$" + $q + "\"\\\\]";
def QSEPQ: "[" + WS + ";&|()<>" + $q + "\"\\\\]";
def SHN: "(?:" + NS + "{0,256}/)?(?:ba|z|da|k)?sh";
def SHANY: "(?:^|[" + WS + ";&|(])(?:" + NS + "{0,256}/)?(?:ba|z|da|k|s)?sh(?=$|[" + WS + ";&|)])";
def SHC: "(?:^|[" + WS + ";&|(])" + SHN + "(?:" + SP + "+-[A-Za-z]+){0,4}" + SP + "+-[A-Za-z]*c[A-Za-z]*" + SP + "+$";
def SHCH: "(?:^|[" + WS + ";&|(])" + SHN + SP + "+[^\n;&|]*-[A-Za-z]*c[A-Za-z]*(?=$|" + SP + ")";
def SHCD: "(?:^|[" + WS + ";&|(])" + SHN + SP + "+-[A-Za-z]*c[A-Za-z]*" + SP + "+$";
def HDOP: "(?<![<])<<(?<dash>-?)(?![<])[ \t]*(?<w>(?:" + $q + "[^" + $q + "]*" + $q + "|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|\\\\[\\s\\S]|[^" + WS + ";&|()<>" + $q + "\"\\\\])+)";
def HDW: "^(?:" + $q + "[A-Za-z0-9_.-]*" + $q + "|\"[A-Za-z0-9_.-]*\"|\\\\[A-Za-z0-9_.-]|[A-Za-z0-9_.-])+$";
def TEXTB: [match("\\\\[\\s\\S]|(?<s>\\$\\([^()\n]*\\)|`[^`\n]*`)|[^\\\\$`]+|[$`]"; "g") | .captures[] | select(.name == "s" and .string != null) | .string] | join(" ");
def DQC: gsub("(?<s>\\$\\([^()]*\\)|`[^`]*`)|\\\\(?<c>[\\s\\S])|(?<w>" + QSEPQ + ")"; if .s then .s elif .c then (if .c == "\n" then "" elif (.c | test(QSEPQ)) then "_" else .c end) else "_" end);
def QTOK: "\\$" + $q + "(?:[^" + $q + "\\\\]|\\\\[\\s\\S])*" + $q + "?|\\$?\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"?|" + $q + "[^" + $q + "]*" + $q + "?|\\\\[\\s\\S]?|[^\"" + $q + "\\\\$]+|\\$";
def qkind: if startswith("$" + $q) then "a" elif startswith("\"") or startswith("$\"") then "h" elif startswith($q) then "s" elif startswith("\\") then "e" else "p" end;
def qscan($q0): . as $l
  | (if $q0 == "s" then ([$l | match("^[^" + $q + "]*" + $q)] | .[0].length) elif $q0 == "d" then ([$l | match("^(?:[^\"\\\\]|\\\\[\\s\\S])*\"")] | .[0].length) else 0 end) as $st
  | if $st == null then {q: $q0, h: null} else ($l[$st:]) as $c
    | [$c | match(QTOK; "g") | {o: .offset, n: .length, s: .string, k: (.string | qkind)}] as $t
    | ([$t[] | select(.k == "p") | .o as $o | (.s | [match("(?:^|[" + WS + ";&|(])#")] | .[0].offset) as $x | select($x != null) | $o + $x] | .[0]) as $cm
    | ([$c | match(HDOP)] | .[0]) as $h | ([$t[] | select($cm == null or .o < $cm)] | .[-1]) as $z
    | {q: (if $z == null then "" elif ($z.k == "s" and ($z.s | test("^" + $q + "[^" + $q + "]*" + $q + "$") | not))
             or ($z.k == "a" and ($z.s | test("^\\$" + $q + "(?:[^" + $q + "\\\\]|\\\\[\\s\\S])*" + $q + "$") | not)) then "s"
           elif $z.k == "h" and ($z.s | test("^\\$?\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"$") | not) then "d" else "" end),
       h: (if $h != null and ($cm == null or $h.offset < $cm) and any($t[]; .o <= $h.offset and $h.offset < .o + .n
             and (.k == "p" or (.k == "h" and (.s[0:$h.offset - .o] | test("\\$\\([^)]*$"))))) then ($h | .offset += $st) else null end)}
  end;
def hdocs: if test("<<") | not then {s: ., ok: true} else . as $all | split("\n") as $ls
  | if ([$ls[] | select(test(HDOP))] | length) > 16 then {s: $all, ok: false} else
    [foreach ($ls[], null) as $l ({m: "code", d: "", t: false, q: "", o: "", bad: false, ok: true};
      if $l == null then .o = null | .bad = (.bad or .m != "code")
      elif .m == "code" then .q as $qq | ($l | qscan($qq)) as $r | .q = $r.q | .o = $l
        | if $r.h == null then . else
          .ok = (.ok and ($l | test("\\\\$") or ([match(HDOP; "g")] | length) > 1 or test("(?:^|[" + WS + ";&|(])(?:source|\\.)" + SP + "+") | not))
          | ([$r.h.captures[] | select(.string != null) | {key: .name, value: .string}] | from_entries) as $c
          | if ($c.w | test(HDW) | not) then .bad = true
            else .d = ($c.w | gsub("[" + $q + "\"\\\\]"; "")) | .t = ($c.dash == "-")
              | .m = (if (($l[0:$r.h.offset] + " " + $l[$r.h.offset + $r.h.length:]) | test(SHANY)) then "fed"
                  elif ($c.w | test("[" + $q + "\"\\\\]")) then "drop" else "text" end) end end
      elif (if .t then ($l | sub("^\t+"; "")) else $l end) == .d then .o = $l | .m = "code"
      elif .m == "fed" then .o = $l
      elif .m == "text" then .o = ($l | TEXTB)
      else .o = "" end;
      [.o, .bad, .ok])] as $r
    | (if $r[-1][1] then $all else [$r[] | .[0] | select(. != null)] | join("\n") end) as $s
    | {s: $s, ok: ($r[-1][2] and ($r[-1][1] | not) and ($s | test("\r\n|\\\\\n|\\|[^\\S\n]*\n|\n[^\\S\n]*\\||}[\\s]*\\|") | not))} end end;
def qread($d; $proof): hdocs | .s | [match(QTOK; "g") | .string | [., qkind]] as $t | ($t | length) as $n
  | [range(0; $n) as $i | $t[$i] as [$s, $k]
    | if $k == "p" then $s
      elif $k == "e" then ($s[1:] | if . == "" or . == "\n" then "" elif test(QSEPQ) then "_" else . end)
      else
        (if $k == "a" then ($s | if length >= 3 and endswith($q) then .[2:-1] else .[2:] end)
         elif $k == "s" then ($s | .[1:] | if endswith($q) then .[0:-1] else . end)
         else ($s | if startswith("$") then .[1:] else . end | .[1:] | if endswith("\"") then .[0:-1] else . end) end) as $c
        | if $d > 0 and $i > 0 and $t[$i - 1][1] == "p" and ($t[$i - 1][0] | test(SHC)) then ($c | qread($d - 1; $proof))
          elif $c == "" then (if ($i == 0 or ($t[$i - 1][0] | test("[" + WS + "]$"))) and ($i == $n - 1 or ($t[$i + 1][0] | test("^[" + WS + ";&|)]"))) then "_" else "" end)
          elif $proof then (if $k == "h" then ($c | TEXTB) else "_" end)
          elif $k == "h" then ($c | DQC)
          else ($c | gsub(QSEP; "_")) end
      end] | join("");
def qmodel: if test("\r\n") then false else hdocs as $h | if $h.ok | not then false else
  [$h.s | match(QTOK; "g") | .string | [., qkind]] as $t | ($t | length) as $n
  | all(range(0; $n); . as $i | $t[$i] as [$s, $k]
    | if $k == "p" then ($s | test("(?:^|[" + WS + ";&|(])#") | not)
        and (if $s | test(SHCH) then ($s | test(SHCD)) and $i + 1 < $n and ($t[$i + 1][1] == "s" or $t[$i + 1][1] == "h")
          and ($i + 2 == $n or ($t[$i + 2][1] == "p" and ($t[$i + 2][0] | test("^(?:[^\\S\n]*$|[^\\S\n]*[\n;&|])"))))
          and ($t[$i + 1][0][1:-1] | qmodel) else true end)
      elif $k == "s" then ($s | test("^" + $q + "[^" + $q + "]*" + $q + "$"))
      elif $k == "a" then ($s | test("^\\$" + $q + "(?:[^" + $q + "\\\\]|\\\\[\\s\\S])*" + $q + "$"))
      elif $k == "h" then ($s | test("^\\$?\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"$"))
        and ($s | gsub(HDOP; "<<_") | test("\\$\\([^)]*[(" + $q + "]|`[^`]*[()" + $q + "]") | not)
      else true end) end end;
def gprune: any(split("[\n;&|]"; null)[]; test("prune") and test("worktree")
  and (([match(GITWT)] | .[0]) as $m | $m != null
    and (([$m.captures[] | select(.name == "rest") | .string // ""] | .[0] | norm) as $r | ($r | [match(GLAST)] | .[0].captures[0].string) as $f
      | ($r | test("[$<>`]")) or $f == null or ($f | startswith("--no-d")))));
def pplain: gsub("\\\\\n"; "") | any(split("[\n;&|]"; null)[]; test(PANC) and test(WANC) and (norm | gprune));
def pmatch: select(any(split("[;&|]"; null)[]; test(PANC) and test(WANC))) | select(gprune or pplain)
  | select((qmodel | not) or (qread(1; true) | test(PANC)) or (qread(1; false) | gprune))
  | "prune\tgit worktree prune";
def EXP: "(?:\\$\\{[^}]*\\}|\\$\\([^)]*\\)|\\$[A-Za-z_][A-Za-z0-9_]*|`[^`]*`)";
def EXPV: WB + EXP + SP + "+" + FLAGS;
def xmatch:
  (("ws-rm", "ws-reap", "ws-archive", "ws-restore", "ws-reclaim", "ws-expire", "ws-collect", "ws-orphan", "scratch-rescue", "ws-shed-deps", "keep-awake", "ws-lease-mark", "delegation-adopt", "docs-folder", "roll", "claude") as $v
     | select(test(EXPV + $v + NW)) | "verb\tccd \($v)"),
  (select(hbt("[;&|]"; EXPV + "ws-gc(?=" + SP + "|$)"; SP + "--prune" + NW)) | "verb\tccd ws-gc --prune"),
  (select(test(WB + "ccrc" + NW) and test(EXPV + "(?:update|rollback|rollout)" + NW)) | "verb\tccrc update, rollback or rollout"),
  (select(test(EXPV + "approvals" + NW)) | "surface\tthe approval surface"),
  (ACCTV as $v | select(test(WB + "ccrc" + NW) and test(EXPV + "account" + SP + "+" + FLAGS + $v + NW)) | "account\tccrc account \($v)"),
  (select(test(WB + "ccd" + NW) and test(EXPV + "account-pane" + NW)) | "account\tccd account-pane");
def QZV: "record", "confirm", "status";
def QZP: "(?:" + WB + "ccrc-api[" + $q + "\"]?" + SP + "+" + FLAGS + "|" + EXPV + ")quiz" + SP + "+" + FLAGS;
def QZR: "quiz-record(?![A-Za-z0-9_.-])";
def QZH: "ccrc-quiz-record(?![A-Za-z0-9_.-])";
def QZCMD: "(?:^|[\n;&|(`]|\\$\\()" + SP + "*(?:env(?:" + SP + "+(?:-" + NS + "+(?:" + SP + "+[A-Za-z_][A-Za-z0-9_]*)?|[A-Za-z_][A-Za-z0-9_]*=" + NS + "*))*" + SP + "+)?(?:(?:bash|sh)" + SP + "+" + FLAGS + ")?[" + $q + "\"]?";
def QZANC: "q" + QCH + "u" + QCH + "i" + QCH + "z";
def qzmatch:
  (QZV as $v | select(test(QZP + $v + NW)) | "quiz\tccrc-api quiz \($v)"),
  (select(test(QZP + EXP)) | "quiz\tccrc-api quiz with its act in a variable"),
  (select(test(WB + "ccrc[" + $q + "\"]?" + SP + "+" + FLAGS + QZR) or (test(WB + "ccrc" + NW) and test(EXPV + QZR))) | "quiz\tccrc quiz-record"),
  (select(test("(?:^|[" + WS + ";&|()`" + $q + "\"=]|/\\.local/bin/)" + QZH) or test(QZCMD + "[^" + WS + ";&|()`" + $q + "\"]*/" + QZH)) | "quiz\tccrc-quiz-record");
([($ARGS.named.deny // "") | try (fromjson | .permissions.deny | arrays | .[] | strings) catch empty]) as $dl
| ([$dl[] | capture("^Bash\\((?<p>[a-z][a-z0-9-]{0,31}) install:\\*\\)$") | .p | select(. != "claude")
    | . as $p | select(any($dl[]; . == "Bash(" + $p + " update:*)"))] | unique) as $ups
| def UPRE: if ($ups | length) == 0 then "(?!)" else "(?:" + ($ups | join("|")) + ")" end;
def SEPP: "/(?:\\.?/){0,8}";
def PSTOP: "(?!(?:-p|--print)(?=" + SP + "|$)|--print=)";
def CFLAGS: "(?:" + PSTOP + "-" + NS + "*(?:" + SP + "+(?!-)" + NS + "+)?" + SP + "+){0,8}";
def VEND: NW + "(?![./])";
def CVERB: "(?:install|update|upgrade)" + VEND;
def VERS: "[0-9]{1,9}\\.[0-9]{1,9}\\.[0-9]{1,9}";
def ENTW: "[^" + WS + "/;&|()<>`" + $q + "\"]{1,64}";
def VERH: "\\.local" + SEPP + "share" + SEPP + "claude" + SEPP + "versions" + SEPP + ENTW;
def EXECH: "\\$\\{?CLAUDE_CODE_EXECPATH\\}?";
def RUNH: WB + "(?:npx|bunx|(?:pnpm|yarn)" + SP + "+dlx|(?:npm|pnpm)" + SP + "+exec)" + SP + "+(?:-" + NS + "*" + SP + "+){0,8}@anthropic-ai/claude-code(?:@" + NS + "{1,64})?";
def CLI: "(?:" + WB + "claude[A-Za-z0-9-]*|" + WB + UPRE + "|" + SEPP + "\\.local" + SEPP + "bin" + SEPP + "[a-z][a-z0-9-]{0,31}|" + VERH + "|" + EXECH + "|" + RUNH + ")";
def CRUN: SP + "+(?:" + CFLAGS + CVERB + "|respawn" + VEND + ")";
def META: ";&|()<>`" + $q + "\"";
def BT: "(?![A-Za-z0-9_.-])";
def LOC: "(?:" + SEPP + "|(?<![^" + WS + "=:" + $q + "\"]))\\.local" + SEPP;
def GLOBW: "[^" + WS + "/" + META + "]{0,64}";
def BUILDX: "(?:" + LOC + "share" + SEPP + "claude" + SEPP + "versions" + BT
  + "|" + LOC + "share" + SEPP + "claude(?:" + SEPP + GLOBW + "[*?\\[{]" + GLOBW + ")?/{0,8}(?=$|[" + WS + META + "])"
  + "|" + LOC + "bin" + SEPP + "(?:claude|" + UPRE + ")" + BT + ")";
def SEG: "\n|;|(?<!>)&(?!>)|(?<!>)\\|";
def RDR: "(?>&>>?|>(?!&[0-9-])(?:>|\\||&)?)(?!" + SP + "{0,8}/dev/null" + NW + ")";
def BWR: "(?:" + RDR + "|" + NB + "tee" + NA + "|" + NB + "sed" + SP + "+" + FLAGS + "-i|" + NB + "perl" + SP + "+-" + NS + "*i|" + NB
  + "(?:mv|cp|ln|truncate|rm|install|dd|rsync|tar|unzip|chmod|chown|touch|mkdir|curl|wget|unlink|shred|patch)" + NA + ")";
def hb1($head; $tail): ([match("^[\\s\\S]*(?=" + $tail + ")")] | if length == 0 then -1 else .[0].length end) as $last
  | $last >= 0 and (.[0:$last] | test($head));
def END: "(?=$|[" + WS + ";&|)])";
def ANC: "(?:(?:~|\\$\\{?HOME\\}?|/[^" + WS + ";&|()<>]{0,256}?)?" + SEPP + "|\\./)?";
def CDH: "(?:^|[" + WS + "(])(?:cd|pushd)" + SP + "+(?:-[PLe]{1,3}" + SP + "+){0,2}";
def CDT($dir): CDH + ANC + $dir + "/{0,8}" + END;
def OPW: "(?<![^" + WS + "=/])";
def VERSD: CDT("\\.local" + SEPP + "share" + SEPP + "claude" + SEPP + "versions");
def cdthen($cd; $gate; f): test($cd) and test($gate) and (split(SEG; null) as $s
  | ([range(0; $s | length) | select($s[.] | test($cd))] | .[0]) as $k
  | $k != null and any($s[$k + 1:][]; f));
def BI: "build\tinstalling or updating a Claude Code build";
def BW: "build\ta write to a Claude Code build or its launcher";
def BTR: "build\ta write to a file the Claude Code launcher, roll or guard trusts";
def TCH: "[A-Za-z0-9_.*?\\[\\]{},-]";
def TNC: "claude-" + TCH + "{1,64}";
def TNS: "(?:claude-roll-" + TCH + "{1,64}|" + TCH + "{1,128}\\.(?:claude-canary|claude-build|deny-settings)|\\.claude-roll\\.lock|(?:child|account)-deny\\.settings\\.json|child-deny\\.digests)" + BT;
def DANC: "(?:" + SEPP + "|(?<![^" + WS + "=:" + $q + "\"]))";
def TGL: GLOBW + "[*?\\[{]" + GLOBW + "/{0,8}(?=$|[" + WS + META + "])";
def TRUST: "(?:" + DANC + "\\.ccrc" + SEPP + "(?:" + TNC + "|" + TGL + ")|" + DANC + "\\.cc-sessions" + SEPP + "(?:" + TNS + "|" + TGL + "))";
def PDIR($d): DANC + $d + "(?:/\\.?){0,8}(?=$|[" + WS + META + "])";
def COMP($n): "(?:^|[" + WS + "/=])" + $n + "(?=$|[" + WS + "/;&|)])";
def pdirw($d; $n): test(PDIR($d)) and test(COMP($n)) and any(split(SEG; null)[]; test(BWR) and test(PDIR($d)) and test(COMP($n)));
def findw($re): test(NB + "find" + NA) and test($re) and any(split(SEG; null)[]; test(NB + "find" + NA) and test($re)
  and test(SP + "-(?:delete|exec|execdir|ok|okdir)" + NW));
def xargsw($re): test(NB + "xargs" + NA) and test($re) and any(split("[\n;&]"; null)[]; split("|") as $p
  | ([range(0; $p | length) | select($p[.] | test($re))] | .[0]) as $k
  | $k != null and any($p[$k + 1:][]; test("^" + SP + "*xargs" + NA) and test(BWR)));
def INTERP: NB + "(?:python[0-9.]{0,8}|node|perl|ruby|bun|deno)" + NA;
def varw($re): test($re) and test("=") and (. as $c
  | [limit(17; match("(?:^|[" + WS + ";&|(])(?<n>[A-Za-z_][A-Za-z0-9_]{0,63})=(?<v>[^" + WS + ";&|()]{0,1024})"; "g")
      | select(.captures[1].string | test($re)) | .captures[0].string)]
  | length > 16 or (length > 0 and (unique as $ns | $c | hbt(SEG; BWR; "\\$\\{?(?:" + ($ns | join("|")) + ")" + NA))));
def VERW: "(?:^|[" + WS + "(])(?:\\./{1,8}" + ENTW + "|" + VERS + ")" + CRUN;
def CLOP: "claude(?=$|[" + WS + "/;&|)])";
def LBOP: "bin" + SEPP + "(?:claude|" + UPRE + ")(?=$|[" + WS + ";&|)])";
def bmatch:
  (select(test(BUILDX) and hbt(SEG; BWR; BUILDX)) | BW),
  (select(findw(BUILDX)) | BW),
  (select(xargsw(BUILDX)) | BW),
  (select(test(INTERP) and test(BUILDX)) | BW),
  (select(cdthen(CDT("\\.local" + SEPP + "share" + SEPP + "claude(?:" + SEPP + "versions)?"); BWR; test(BWR))) | BW),
  (select(cdthen(CDT("\\.local" + SEPP + "share"); OPW + CLOP; hb1(BWR; OPW + CLOP))) | BW),
  (select(cdthen(CDT("\\.local"); "(?:share" + SEPP + CLOP + "|" + LBOP + ")";
     hb1(BWR; OPW + "(?:share" + SEPP + CLOP + "|" + LBOP + ")"))) | BW),
  (select(cdthen("(?:" + CDH + "(?:~|\\$\\{?HOME\\}?)/{0,8}" + END + "|(?:^|[" + WS + "(])cd" + SP + "*$)"; "\\.local" + SEPP + "(?:share" + SEPP + CLOP + "|" + LBOP + ")";
     hb1(BWR; OPW + "\\.local" + SEPP + "(?:share" + SEPP + CLOP + "|" + LBOP + ")"))) | BW),
  (select(cdthen(CDT("\\.local" + SEPP + "bin"); OPW + "(?:claude|" + UPRE + ")" + END; hb1(BWR; OPW + "(?:claude|" + UPRE + ")" + END))) | BW),
  (select(varw(BUILDX)) | BW),
  (select(pdirw("\\.local(?:" + SEPP + "(?:share|bin))?"; "(?:claude|" + UPRE + ")")) | BW),
  (select(test(TRUST) and hbt(SEG; BWR; TRUST)) | BTR),
  (select(findw(TRUST)) | BTR),
  (select(xargsw(TRUST)) | BTR),
  (select(test(INTERP) and test(TRUST)) | BTR),
  (select(varw(TRUST)) | BTR),
  (select(pdirw("\\.ccrc"; TNC) or pdirw("\\.cc-sessions"; TNS)) | BTR),
  (select(cdthen(CDT("\\.ccrc"); OPW + TNC; hb1(BWR; OPW + TNC))) | BTR),
  (select(cdthen(CDT("\\.cc-sessions"); OPW + TNS; hb1(BWR; OPW + TNS))) | BTR),
  (select(test(CLI + CRUN)) | BI),
  (select(test(WB + "(?:claude|" + UPRE + ")" + NW) and test(WB + EXP + SP + "+(?:" + FLAGS + "(?:install|update)" + NW + "|" + CFLAGS + CVERB + "|respawn" + VEND + ")")) | BI),
  (select(cdthen(VERSD; VERW; test(VERW))) | BI),
  (select(test("claude\\.ai/install\\.(?:sh|ps1|cmd)|downloads\\.claude\\.ai"; "i")) | BI),
  (select(test("@anthropic-ai/claude-code") and any(split("[\n;&|]"; null)[]; test(WB + "(?:npm|pnpm|yarn|bun)" + NW)
     and test(SP + "(?:install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add|update|udpate|up|upgrade)" + NW)
     and test("@anthropic-ai/claude-code")
     and (test("(?:^|" + SP + ")(?:(?:-g|--global|--location=global|global)" + NW + "|--prefix(?:=|" + SP + "+)" + NS + "{0,256}\\.local(?![A-Za-z0-9_-]))")
       or test("(?:^|" + SP + ")npm_config_(?:global|location)="; "i")))) | BI);
def pnorm: (if startswith("~/") then ($ENV.HOME // "~") + .[1:] else . end)
  | if startswith("/") then "/" + (split("/") | reduce .[] as $s ([]; if $s == "" or $s == "." then .
      elif $s == ".." then .[:-1] else . + [$s] end) | join("/")) else . end;
def edittool: . == "Write" or . == "Edit" or . == "MultiEdit" or . == "NotebookEdit";
def ASEC: "(?:" + DANC + "\\.cc-secrets(?![A-Za-z0-9_.-])|" + DANC + "\\.cc-sessions" + SEPP + "\\.door(?![A-Za-z0-9_.-])|" + DANC + "\\.ccrc" + SEPP + "(?:auth-scratch(?![A-Za-z0-9_.-])|agent\\.env(?![A-Za-z0-9_.-])|linear(?:\\.key)?(?![A-Za-z0-9_.-])|operator-secrets(?![A-Za-z0-9_.-])|operator-model\\.db|privacy-journal\\.log(?![A-Za-z0-9_.-])|privacy-journal\\.torn(?![A-Za-z0-9_.-])|coordination-restore\\.(?:stage|foreign)" + SEPP + "[^" + WS + "/;&|()<>]{1,64}" + SEPP + "operator-model\\.db|codex" + SEPP + "[^" + WS + "/;&|()<>]{1,64}" + SEPP + "runtime\\.env(?![A-Za-z0-9_.-]))|" + DANC + "ccrc-backups" + SEPP + "[^" + WS + "/;&|()<>]{1,64}" + SEPP + "operator-model\\.db)";
def AWD: DANC + "\\.cc-sessions" + SEPP + "\\.(?:auth|accounts|door)(?![A-Za-z0-9_.-])";
def ENVP: "(?:[(`{]|\\$\\()";
def ENVB: "^" + SP + "*(?:" + ENVP + SP + "*){0,4}(?:[A-Za-z_][A-Za-z0-9_]{0,63}=" + NS + "*" + SP + "+){0,8}(?:exec" + SP + "+)?(?:" + NS + "*/)?(?:env|printenv)(?:" + SP + "+(?:-0|--null))*" + SP + "*[)`}]{0,4}" + SP + "*$";
def ENVS: "(?:\\$\\(|`)" + SP + "*(?:[^" + WS + "/)`]*/)?(?:env|printenv)(?:" + SP + "+(?:-0|--null))*" + SP + "*[)`]";
def BSHC: "^" + SP + "*(?:" + NS + "*/)?(?:bash|sh)" + SP + "+-c" + SP + "+";
def ARF: DANC + "\\.ccrc" + SEPP + "accounts\\.(?:json|sh)" + BT;
def AOPRUN: "^" + SP + "*(?:[(`{]" + SP + "*){0,4}(?:(?:then|do|else|if|while|!)" + SP + "+){0,2}(?:[A-Za-z_][A-Za-z0-9_]*=" + NS + "*" + SP + "+){0,8}(?:(?:exec|env|time|nohup|command)" + SP + "+){0,2}(?:(?:" + NS + "*/)?(?:node|nodejs|bun|deno)" + SP + "+(?:-" + NS + "*" + SP + "+){0,8})?(?:" + NS + "*/)?account-op\\.mjs" + BT;
def PMN: "(?:operator-model\\.db|privacy-journal\\.(?:log|torn)" + BT + ")";
def PMNS: ["operator-model.db", "operator-model.db-wal", "operator-model.db-shm", "privacy-journal.log", "privacy-journal.torn"];
def g2re: gsub("(?<c>[.+^$()|\\\\])"; "\\\(.c)") | gsub("\\[!"; "[^") | gsub("\\*"; "[^/]*") | gsub("\\?"; "[^/]")
  | gsub("\\{(?<x>[^{}]*)\\}"; "(?:" + (.x | gsub(","; "|")) + ")");
def pmglob: [match(DANC + "\\.ccrc" + SEPP + "(?<g>" + GLOBW + "[*?\\[{]" + GLOBW + ")(?=$|[" + WS + META + "])"; "g") | .captures[0].string]
  | any(.[]; g2re as $r | any(PMNS[]; try test("^(?:" + $r + ")$") catch true));
def PMEX: "^" + SP + "*(?:ls|rm)" + NW;
def PMBULK: NB + "(?:tar|zip|grep|rg)" + NA;
def PMCOPY: NB + "(?:cp|rsync|scp)" + NA;
def PMCPT: NB + "cp" + NA + "[^\n]*(?:^|" + SP + ")(?:--target-directory|-[A-Za-z]*t[A-Za-z]*)(?=$|[=" + WS + "])";
def apmatch:
  (select(test(ASEC)) | "account\ta secret or scratch path of a fleet account"),
  (select(test(PMN) and cdthen(CDT("\\.ccrc"); PMN; test("(?:^|[" + WS + "/=])" + PMN))) | "account\tthe private store or its journal, after a cd into ~/.ccrc"),
  (select(test("\\.ccrc") and any(split(SEG; null)[]; (test(PMEX) | not) and pmglob)) | "account\ta glob under ~/.ccrc that can match the private store or its journal"),
  (select(test("\\.ccrc") and any(split(SEG; null)[]; (test(PMBULK) and test(PDIR("\\.ccrc")))
     or (test(PMCOPY) and test(PDIR("\\.ccrc") + SP + "+[^" + WS + META + "]")) or (test(PMCPT) and test(PDIR("\\.ccrc"))))) | "account\ta copy or recursive read of ~/.ccrc, which holds the private store"),
  (select(test(AWD) and (hbt(SEG; BWR; AWD) or findw(AWD) or xargsw(AWD))) | "account\ta write under the account state directories"),
  (select(test(ARF) and (hbt(SEG; BWR; ARF) or findw(ARF) or xargsw(ARF))) | "account\ta write of the roster or its mirror"),
  (select(test("account-op") and any(split(SEG; null)[]; test(AOPRUN))) | "account\ta direct run of the account script"),
  (select(test("env") and (test(ENVS) or any(split(SEG; null)[]; test(ENVB) or (test(BSHC) and (sub(BSHC; "") | test(ENVB)))))) | "account\tprinting the whole environment");
def APSEC: "/\\.cc-secrets(?:/|$)|/\\.cc-sessions/\\.door(?:/|$)|/\\.ccrc/auth-scratch(?:/|$)|/\\.ccrc/codex/[^/]+/runtime\\.env$|/\\.ccrc/agent\\.env$|/\\.ccrc/linear(?:/|$)|/\\.ccrc/linear\\.key$|/\\.ccrc/operator-secrets(?:/|$)|/\\.ccrc/operator-model\\.db|/\\.ccrc/privacy-journal\\.log$|/\\.ccrc/privacy-journal\\.torn(?:/|$)|/ccrc-backups/[^/]+/operator-model\\.db|/\\.ccrc/coordination-restore\\.(?:stage|foreign)/[^/]+/operator-model\\.db";
def APWD: "/\\.cc-sessions/\\.(?:auth|accounts|door)(?:/|$)";
def APRF: "/\\.ccrc/accounts\\.(?:json|sh)$";
def acctpath($t; $i):
  if ($t | edittool) then first(($i.file_path, $i.notebook_path) | select(type == "string") | pnorm | select(test(APSEC) or test(APWD) or test(APRF)) | "account\ta write to an account path")
  elif $t == "Read" or $t == "Grep" or $t == "Glob" then first(($i.file_path, $i.path, (if $t == "Glob" then $i.pattern else empty end)) | select(type == "string") | pnorm | select(test(APSEC)) | "account\ta read of a secret or scratch path of a fleet account")
  else empty end;
def pathwhy($t):
  first((.file_path, .path, .notebook_path) | select(type == "string")
    | if test(PATHF) then "other\ta forbidden path"
      elif ($t | edittool) and test("(?:^|/)" + SENS) then "other\tan edit to a settings file, a hook or a CLAUDE.md"
      elif ($t | edittool) and test(BUILD) then "other\ta write to a Claude Code build or its launcher"
      elif $t == "Read" and test(CRED) then "other\treading a secret"
      else empty end);
(.tool_name | if type == "string" then . else "" end) as $t
| (.tool_input | if type == "object" then . else {} end) as $i
| if $mode == "deny" then
    (if $t == "Bash" then ($i.command | if type == "string" then first((., norm) | (fmatch, xmatch) | select(startswith("verb\t") or startswith("surface\t") or startswith("account\t"))) // first(pmatch) // first((., norm) | apmatch) // first(select(test(QZANC)) | (., norm) | qzmatch) // first((., norm) | bmatch) // "" else "" end)
     elif ($t | edittool) then (first(($i.file_path, $i.notebook_path) | select(type == "string" and test("approval-signing|approval-verify\\.mjs")) | "surface\ta write to the approval surface") // acctpath($t; $i) // first(($i.file_path, $i.notebook_path) | select(type == "string") | pnorm | select(test(BUILDX)) | BW) // first(($i.file_path, $i.notebook_path) | select(type == "string") | pnorm | select(test(TRUST)) | BTR) // "")
     elif $t == "Read" or $t == "Grep" or $t == "Glob" then (first(($i.file_path, $i.path, (if $t == "Glob" then $i.pattern else empty end)) | select(type == "string" and test("approval-signing")) | "surface\ta read of a signing key") // acctpath($t; $i) // "")
     else "" end)
  elif $mode == "account" then
    (if $t == "Bash" then ($i.command | if type == "string" then first((., norm) | (fmatch, xmatch) | select(startswith("account\t"))) // first(pmatch) // first((., norm) | apmatch) // first(select(test(QZANC)) | (., norm) | qzmatch) // "" else "" end)
     else acctpath($t; $i) // "" end)
  elif $t == "Bash" then ($i.command | if type == "string" then first(fmatch, pmatch) // "" else "" end)
  elif ($t | startswith("mcp__")) and any($i | .. | strings; first(fmatch, pmatch) != null) then "other\tan MCP call naming a forbidden act"
  else ($i | pathwhy($t)) // ""
  end