package attention

import (
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"ccrc/core/internal/kernel"
)

// Forbidden is APPROVAL_FORBIDDEN_JQ (ccd/session-hook.sh), as `jq -r --arg q "'" --arg mode <mode> [--arg deny <text>]`
// prints it for payload v: `<category>\t<why>`, or "" (ok false where jq errors, which the hook reads as ""). deny is the
// deny file's text the hook passes (nil: no `--arg deny`), home is jq's `$ENV.HOME` (nil: HOME unset).
//
// The program's regexes are Oniguruma's; each is spelled here for RE2 with its lookarounds rewritten by one of four rules,
// and every rule is held to real jq by guard_test.go over testdata/guard-cases.jsonl:
//   - a lookahead or lookbehind of one character class at a pattern's END or START, in a pattern only tested for a match,
//     becomes that character (or `\z`, `\A`) consumed: `(?![A-Za-z0-9_-])` is `(?:[^A-Za-z0-9_-]|\z)` (nwEnd), and
//     `(?<![^X])` is `(?:\A|[X])`; a `$` (Oniguruma's `\Z`) at the end is `\n?\z`, or `\z` where the class before it
//     already holds the newline;
//   - in `hbt`/`hb1`'s tail, whose START is what is measured, a leading lookbehind becomes a prefix group, `\A((?:.*[X])?)`,
//     taken per lookbehind class (lastStart);
//   - an atomic group and a lookaround inside a loop, or one feeding an offset (RDR, HDOP, the separator SEG, GVAL's
//     `\$(?!\()`), is a small scanner or an equivalent regular rewrite, each named where it stands;
//   - `test(…; "i")` folds case as Oniguruma does (ifoldContains), whose full folding the regex engine here lacks.
func Forbidden(v any, mode string, deny, home *string) (string, bool) {
	tn, err := index(v, "tool_name")
	if err != nil {
		return "", false
	}
	ti, err := index(v, "tool_input")
	if err != nil {
		return "", false
	}
	t, _ := tn.(string)
	in, ok := ti.(kernel.Obj)
	if !ok {
		in = kernel.Obj{}
	}
	g := newGuard(deny)
	cmd, isCmd := get(in, "command").(string)
	switch mode {
	case "deny":
		switch {
		case t == "Bash":
			if !isCmd {
				return "", true
			}
			if r := g.firstVerb(cmd, "verb\t", "surface\t", "account\t"); r != "" {
				return r, true
			}
			if pmatch(cmd) {
				return pruneWhy, true
			}
			for _, f := range []func(string) string{g.apmatch, g.qzmatch, g.bmatch} {
				if r := f(cmd); r != "" {
					return r, true
				}
				if r := f(norm(cmd)); r != "" {
					return r, true
				}
			}
			return "", true
		case editTool(t):
			for _, p := range strs(in, "file_path", "notebook_path") {
				if surfaceWrite().MatchString(p) {
					return "surface\ta write to the approval surface", true
				}
			}
			if r := acctpath(t, in, home); r != "" {
				return r, true
			}
			for _, p := range strs(in, "file_path", "notebook_path") {
				if g.buildx().MatchString(pnorm(p, home)) {
					return bwWhy, true
				}
			}
			for _, p := range strs(in, "file_path", "notebook_path") {
				if g.trust().MatchString(pnorm(p, home)) {
					return btrWhy, true
				}
			}
			return "", true
		case t == "Read" || t == "Grep" || t == "Glob":
			for _, p := range readPaths(t, in) {
				if strings.Contains(p, "approval-signing") {
					return "surface\ta read of a signing key", true
				}
			}
			return acctpath(t, in, home), true
		}
		return "", true
	case "account":
		if t == "Bash" {
			if !isCmd {
				return "", true
			}
			if r := g.firstVerb(cmd, "account\t"); r != "" {
				return r, true
			}
			if pmatch(cmd) {
				return pruneWhy, true
			}
			for _, f := range []func(string) string{g.apmatch, g.qzmatch} {
				if r := f(cmd); r != "" {
					return r, true
				}
				if r := f(norm(cmd)); r != "" {
					return r, true
				}
			}
			return "", true
		}
		return acctpath(t, in, home), true
	}
	switch {
	case t == "Bash":
		if !isCmd {
			return "", true
		}
		if r := g.fmatchFirst(cmd); r != "" {
			return r, true
		}
		if pmatch(cmd) {
			return pruneWhy, true
		}
		return "", true
	case strings.HasPrefix(t, "mcp__"):
		hit := false
		walkStrings(in, func(s string) bool {
			if g.fmatchFirst(s) != "" || pmatch(s) {
				hit = true
			}
			return hit
		})
		if hit {
			return "other\tan MCP call naming a forbidden act", true
		}
	}
	return pathwhy(t, in), true
}

const (
	pruneWhy = "prune\tgit worktree prune"
	bwWhy    = "build\ta write to a Claude Code build or its launcher"
	btrWhy   = "build\ta write to a file the Claude Code launcher, roll or guard trusts"
	biWhy    = "build\tinstalling or updating a Claude Code build"
)

func editTool(t string) bool {
	return t == "Write" || t == "Edit" || t == "MultiEdit" || t == "NotebookEdit"
}

// strs is `($i.a, $i.b, …) | select(type == "string")`.
func strs(in kernel.Obj, keys ...string) []string {
	var out []string
	for _, k := range keys {
		if s, ok := get(in, k).(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func readPaths(t string, in kernel.Obj) []string {
	if t == "Glob" {
		return strs(in, "file_path", "path", "pattern")
	}
	return strs(in, "file_path", "path")
}

// walkStrings is `.. | strings`, depth first, until f answers true.
func walkStrings(v any, f func(string) bool) bool {
	switch x := v.(type) {
	case string:
		return f(x)
	case kernel.Obj:
		for _, kv := range x {
			if walkStrings(kv.V, f) {
				return true
			}
		}
	case []any:
		for _, e := range x {
			if walkStrings(e, f) {
				return true
			}
		}
	}
	return false
}

// ── the classes and pieces the program's defs build ──

// wsc is the class body of the program's WS: JavaScript's `\s` set, built by implode (`8192, 45, 8202` is the range
// U+2000-U+200A, the 45 a hyphen between them), so FEFF is in it and U+0085 is not.
const wsc = `\t-\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

const (
	sp     = `[` + wsc + `]`
	ns     = `[^` + wsc + `]`
	wb     = "(?:\\A|[" + wsc + ";&|()`'\"=/])"
	nwEnd  = `(?:[^A-Za-z0-9_-]|\z)`  // NW at a pattern's end
	nbS    = `(?:\A|[^A-Za-z0-9_])`   // NB at an alternative's start
	naEnd  = `(?:[^A-Za-z0-9_]|\z)`   // NA at a pattern's end
	btEnd  = `(?:[^A-Za-z0-9_.-]|\z)` // BT and `(?![A-Za-z0-9_.-])` at a pattern's end
	flags  = `(?:-` + ns + `+` + sp + `+)*`
	ccdH   = wb + `ccd['"]?` + sp + `+` + flags
	sepp   = `/(?:\.?/){0,8}`
	meta   = ";&|()<>`'\""
	globw  = `[^` + wsc + `/` + meta + `]{0,64}`
	endAny = `(?:\z|[` + wsc + meta + `])` // `(?=$|[WS META])`
	endCmd = `(?:\z|[` + wsc + `;&|)])`    // END, `(?=$|[WS;&|)])`
	exp    = "(?:\\$\\{[^}]*\\}|\\$\\([^)]*\\)|\\$[A-Za-z_][A-Za-z0-9_]*|`[^`]*`)"
	expv   = wb + exp + sp + `+` + flags
	// the lookbehind classes, as the characters allowed before: `(?<![^X])` allows X, `(?<![X])` allows [^X]
	lbDanc = `[` + wsc + `=:'"]`
	lbOpw  = `[` + wsc + `=/]`
)

var fmVerbs = []string{"ws-rm", "ws-reap", "ws-archive", "ws-restore", "ws-reclaim", "ws-expire", "ws-collect", "ws-orphan",
	"scratch-rescue", "ws-shed-deps", "keep-awake", "ws-lease-mark", "delegation-adopt", "roll", "claude"}

var acctVerbs = []string{"add", "auth-start", "auth-code", "auth-cancel", "set", "check", "enable", "disable", "credential",
	"remove", "seed", "openrouter-management"}

// lb is a lookbehind's allowed class in its two forms: consumed at a tested pattern's start, or as lastStart's prefix.
func lbTest(allowed string) string { return `(?:\A|` + allowed + `)` }

// tailAlts is a tail as its alternatives grouped by the lookbehind each starts with ("" for none).
type tailAlts []struct{ lb, body string }

func (t tailAlts) test() string {
	var p []string
	for _, a := range t {
		if a.lb == "" {
			p = append(p, a.body)
		} else {
			p = append(p, lbTest(a.lb)+`(?:`+a.body+`)`)
		}
	}
	return `(?:` + strings.Join(p, "|") + `)`
}

// lastStart is `[match("^[\\s\\S]*(?=" + tail + ")")] | .[0].length`: the LAST position the tail matches at (overlapping
// starts included), or -1. A greedy `\A(.*)` before the tail is that position (RE2 picks the leftmost-first match a
// backtracking engine would), one regex per lookbehind class, the largest answer kept.
type lastStart struct {
	res []func() *regexp.Regexp
}

func newLastStart(t tailAlts) lastStart {
	groups := map[string][]string{}
	var order []string
	for _, a := range t {
		if _, ok := groups[a.lb]; !ok {
			order = append(order, a.lb)
		}
		groups[a.lb] = append(groups[a.lb], a.body)
	}
	var ls lastStart
	for _, lb := range order {
		pre := `(?s)\A(.*)`
		if lb != "" {
			pre = `(?s)\A((?:.*` + lb + `)?)`
		}
		ls.res = append(ls.res, re(pre+`(?:`+strings.Join(groups[lb], "|")+`)`))
	}
	return ls
}

func (l lastStart) at(s string) int {
	best := -1
	for _, r := range l.res {
		if m := r().FindStringSubmatchIndex(s); m != nil && m[3] > best {
			best = m[3]
		}
	}
	return best
}

// hb1 is `hb1($head; $tail)`: the head matches inside the text before the tail's last start.
func hb1(s string, head func(string) bool, tail lastStart) bool {
	l := tail.at(s)
	return l >= 0 && head(s[:l])
}

// hbt is `hbt($sep; $head; $tail)` over pieces already split.
func hbt(pieces []string, head func(string) bool, tail lastStart) bool {
	for _, p := range pieces {
		if hb1(p, head, tail) {
			return true
		}
	}
	return false
}

// splitAny is `split("[…]"; null)` for a class of single characters.
func splitAny(s, chars string) []string {
	var out []string
	b := 0
	for i := 0; i < len(s); i++ {
		if strings.IndexByte(chars, s[i]) >= 0 {
			out = append(out, s[b:i])
			b = i + 1
		}
	}
	return append(out, s[b:])
}

// segSplit is `split(SEG; null)`, SEG `\n|;|(?<!>)&(?!>)|(?<!>)\|`: a newline and `;` always, `&` with no `>` on either
// side, `|` with no `>` before it, so a redirection's `>&`, `&>` and `>|` stay whole.
func segSplit(s string) []string {
	var out []string
	b := 0
	for i := 0; i < len(s); i++ {
		cut := false
		switch s[i] {
		case '\n', ';':
			cut = true
		case '&':
			cut = !after(s, i, '>') && !(i+1 < len(s) && s[i+1] == '>')
		case '|':
			cut = !after(s, i, '>')
		}
		if cut {
			out = append(out, s[b:i])
			b = i + 1
		}
	}
	return append(out, s[b:])
}

// norm is `gsub("\\\\\n"; "") | gsub("\\$(?=['\"])"; "") | gsub("\\\\(?<c>[\\s\\S])"; .c) | gsub("['\"]"; "")`: the
// command as bash runs it, line continuations, `$` before a quote, backslashes and quotes removed, each pass left to right.
func norm(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) && s[i+1] == '\n' {
			i++
			continue
		}
		b.WriteByte(s[i])
	}
	s, b = b.String(), strings.Builder{}
	for i := 0; i < len(s); i++ {
		if s[i] == '$' && i+1 < len(s) && (s[i+1] == '\'' || s[i+1] == '"') {
			continue
		}
		b.WriteByte(s[i])
	}
	s, b = b.String(), strings.Builder{}
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			n := runeLen(s, i+1)
			b.WriteString(s[i+1 : i+1+n])
			i += n
			continue
		}
		b.WriteByte(s[i])
	}
	return strings.NewReplacer("'", "", `"`, "").Replace(b.String())
}

// rdrAt is RDR at i, `(?>&>>?|>(?!&[0-9-])(?:>|\||&)?)(?!SP{0,8}/dev/null NW)`: the operator taken whole (atomic: no
// shorter form is tried once one matched), then refused when up to eight blanks and /dev/null follow it.
func rdrAt(s string, i int) bool {
	j := -1
	switch {
	case strings.HasPrefix(s[i:], "&>>"):
		j = i + 3
	case strings.HasPrefix(s[i:], "&>"):
		j = i + 2
	case s[i] == '>':
		if i+2 < len(s) && s[i+1] == '&' && (s[i+2] == '-' || (s[i+2] >= '0' && s[i+2] <= '9')) {
			return false
		}
		j = i + 1
		if j < len(s) && (s[j] == '>' || s[j] == '|' || s[j] == '&') {
			j++
		}
	default:
		return false
	}
	k, n := j, 0
	for k < len(s) && n <= 8 {
		r, w := utf8.DecodeRuneInString(s[k:])
		if !isWS(r) {
			break
		}
		k += w
		n++
	}
	if n <= 8 && strings.HasPrefix(s[k:], "/dev/null") {
		e := k + len("/dev/null")
		if e == len(s) || !isWordDash(s[e]) {
			return false
		}
	}
	return true
}

func isWordDash(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '-'
}

// isWS is a rune of the program's WS.
func isWS(r rune) bool {
	switch {
	case r >= '\t' && r <= '\r', r == ' ', r == 0xa0, r == 0x1680, r >= 0x2000 && r <= 0x200a, r == 0x2028, r == 0x2029,
		r == 0x202f, r == 0x205f, r == 0x3000, r == 0xfeff:
		return true
	}
	return false
}

var bwrRest = re(nbS + `tee` + naEnd + `|` + nbS + `sed` + sp + `+` + flags + `-i|` + nbS + `perl` + sp + `+-` + ns + `*i|` + nbS +
	`(?:mv|cp|ln|truncate|rm|install|dd|rsync|tar|unzip|chmod|chown|touch|mkdir|curl|wget|unlink|shred|patch)` + naEnd)

// bwr is `test(BWR)`.
func bwr(s string) bool {
	for i := 0; i < len(s); i++ {
		if (s[i] == '>' || s[i] == '&') && rdrAt(s, i) {
			return true
		}
	}
	return bwrRest().MatchString(s)
}

var wrRe = re(`>|` + nbS + `tee` + naEnd + `|` + nbS + `sed` + sp + `+` + flags + `-i|` + nbS + `perl` + sp + `+-` + ns + `*i|` +
	nbS + `mv` + naEnd + `|` + nbS + `cp` + naEnd + `|` + nbS + `ln` + naEnd + `|` + nbS + `truncate` + naEnd + `|` + nbS + `rm` + naEnd)

// the fixed tails and tests of fmatch
var (
	sensTail  = newLastStart(tailAlts{{"", `CLAUDE\.md|settings(?:\.local)?\.json|session-hook\.sh|/hooks/`}})
	buildTail = newLastStart(tailAlts{{"", `/\.local/share/claude/versions` + btEnd + `|/\.local/bin/claude` + btEnd}})
	credAlts  = tailAlts{
		{"", `\.ssh` + nwEnd + `|\.cc-secrets|\.token` + nwEnd + `|\.env(?:rc|\.[A-Za-z0-9_.-]+)?` + nwEnd + `|credentials|auth\.json|\.netrc|\.pem` + nwEnd +
			`|\.key` + btEnd + `|agent\.env|gh/(?:hosts|config)\.yml|\.docker/config\.json|\.kube/config` + nwEnd + `|\.npmrc|\.pypirc|\.git-credentials` +
			`|\.config/gcloud` + nwEnd + `|_(?:rsa|dsa|ecdsa|ed25519)` + nwEnd + `|deploy_key|ssh_host_|\.pgpass|\.vault-token|rclone\.conf|\.s3cfg` +
			`|\.git/config` + nwEnd + `|\.claude\.json|_(?:ecdsa|ed25519)_sk` + nwEnd + `|\.(?:p12|pfx|jks|keystore)` + nwEnd + `|\.htpasswd|\.my\.cnf|kubeconfig|\.tfstate` +
			`|service[-_]account[A-Za-z0-9_-]*\.json|token\.json` + nwEnd + `|\.yarnrc\.yml`},
		{`[^A-Za-z0-9_-]`, `\.aws` + nwEnd + `|\.gnupg` + nwEnd + `|\.azure` + nwEnd + `|secrets?\.(?:ya?ml|json|toml)` + nwEnd + `|\.boto` + nwEnd},
		{`[^A-Za-z0-9_.-]`, `identity` + btEnd},
	}
	credTail     = newLastStart(credAlts)
	credTest     = re(credAlts.test())
	sessTail     = newLastStart(tailAlts{{"", `claude-session@|ccrc|tmux`}})
	sessHead     = re(wb + `(?:systemctl|systemd-run|kill|pkill|killall)` + nwEnd)
	catHead      = re(wb + `(?:cat|head|tail|less|more|base64|xxd|strings|od|nl|bat)` + nwEnd)
	pruneTail    = newLastStart(tailAlts{{"", sp + `--prune` + nwEnd}})
	gcHead       = re(ccdH + `ws-gc(?:` + sp + `|\z)`)
	gcHeadX      = re(expv + `ws-gc(?:` + sp + `|\z)`)
	tmuxRe       = re(wb + `tmux(?:\z|[` + wsc + `;&|)'"])`)
	regPathRe    = re(`/\.(?:cc-sessions|cc-limits|ccrc)` + btEnd)
	rebootRe     = re(wb + `(?:reboot|shutdown|poweroff|halt)(?:\z|[` + wsc + `;&|)'"])`)
	ccrcUpd      = re(wb + `ccrc['"]?` + sp + `+` + flags + `(?:update|rollback|rollout)` + nwEnd)
	paneRe       = re(ccdH + `account-pane` + nwEnd)
	aauthRe      = re("(?:(?:\\A|[" + wsc + ";&|()`'\"=])|/\\.local/bin/)ccd-account-auth" + btEnd)
	surfaceRe    = re(`(?:ccrc-api|\$\{?API\}?)['"]?` + sp + `+` + flags + `approvals` + nwEnd + `|/api/approvals` + nwEnd + `|/api/questions/approval-|approval-signing|approval-verify\.mjs`)
	ccrcWord     = re(wb + `ccrc` + nwEnd)
	ccdWord      = re(wb + `ccd` + nwEnd)
	updX         = re(expv + `(?:update|rollback|rollout)` + nwEnd)
	apprX        = re(expv + `approvals` + nwEnd)
	paneX        = re(expv + `account-pane` + nwEnd)
	surfaceWrite = re(`approval-signing|approval-verify\.mjs`)
	verbRes      = regexFamily(fmVerbs, func(v string) string { return ccdH + regexp.QuoteMeta(v) + nwEnd })
	verbResX     = regexFamily(fmVerbs, func(v string) string { return expv + regexp.QuoteMeta(v) + nwEnd })
	acctRes      = regexFamily(acctVerbs, func(v string) string {
		return wb + `ccrc['"]?` + sp + `+` + flags + `account` + sp + `+` + flags + regexp.QuoteMeta(v) + nwEnd
	})
	acctResX = regexFamily(acctVerbs, func(v string) string { return expv + `account` + sp + `+` + flags + regexp.QuoteMeta(v) + nwEnd })
)

func regexFamily(words []string, f func(string) string) []func() *regexp.Regexp {
	var out []func() *regexp.Regexp
	for _, w := range words {
		out = append(out, re(f(w)))
	}
	return out
}

// fmatch is the program's `fmatch`, its rows in order: f answers each output and stops the walk when it answers true.
func (g *guard) fmatch(s string, f func(string) bool) bool {
	hasCcd := strings.Contains(s, "ccd")
	if hasCcd {
		for i, v := range fmVerbs {
			if verbRes[i]().MatchString(s) && f("verb\tccd "+v) {
				return true
			}
		}
		if strings.Contains(s, "ws-gc") && hbt(splitAny(s, ";&|"), gcHead().MatchString, pruneTail) && f("verb\tccd ws-gc --prune") {
			return true
		}
	}
	if strings.Contains(s, "tmux") && tmuxRe().MatchString(s) && f("other\ttmux") {
		return true
	}
	if regPathRe().MatchString(s) && f("other\ta registry path") {
		return true
	}
	if rebootRe().MatchString(s) && f("other\treboot or shutdown") {
		return true
	}
	if strings.Contains(s, "ccrc") {
		if ccrcUpd().MatchString(s) && f("verb\tccrc update, rollback or rollout") {
			return true
		}
		if strings.Contains(s, "account") {
			for i, v := range acctVerbs {
				if acctRes[i]().MatchString(s) && f("account\tccrc account "+v) {
					return true
				}
			}
		}
	}
	if hasCcd && strings.Contains(s, "account-pane") && paneRe().MatchString(s) && f("account\tccd account-pane") {
		return true
	}
	if strings.Contains(s, "ccd-account-auth") && aauthRe().MatchString(s) && f("account\tccd-account-auth") {
		return true
	}
	if strings.Contains(s, "approval") && surfaceRe().MatchString(s) && f("surface\tthe approval surface") {
		return true
	}
	if hbt(strings.Split(s, "\n"), sessHead().MatchString, sessTail) && f("other\ta session unit or the tmux scope") {
		return true
	}
	lines := splitAny(s, "\n;&|")
	if hbt(lines, wrRe().MatchString, sensTail) && f("other\tan edit to a settings file, a hook or a CLAUDE.md") {
		return true
	}
	if strings.Contains(s, "/.local/") && hbt(lines, wrRe().MatchString, buildTail) && f("other\ta write to a Claude Code build or its launcher") {
		return true
	}
	if hbt(lines, catHead().MatchString, credTail) && f("other\tprinting a secret") {
		return true
	}
	return false
}

// xmatch is the program's `xmatch`: the verbs after a `$VAR`, `${…}`, `$(…)` or backtick program.
func (g *guard) xmatch(s string, f func(string) bool) bool {
	if !strings.ContainsAny(s, "$`") {
		return false
	}
	for i, v := range fmVerbs {
		if verbResX[i]().MatchString(s) && f("verb\tccd "+v) {
			return true
		}
	}
	if strings.Contains(s, "ws-gc") && hbt(splitAny(s, ";&|"), gcHeadX().MatchString, pruneTail) && f("verb\tccd ws-gc --prune") {
		return true
	}
	if ccrcWord().MatchString(s) && updX().MatchString(s) && f("verb\tccrc update, rollback or rollout") {
		return true
	}
	if apprX().MatchString(s) && f("surface\tthe approval surface") {
		return true
	}
	if ccrcWord().MatchString(s) {
		for i, v := range acctVerbs {
			if acctResX[i]().MatchString(s) && f("account\tccrc account "+v) {
				return true
			}
		}
	}
	if ccdWord().MatchString(s) && paneX().MatchString(s) && f("account\tccd account-pane") {
		return true
	}
	return false
}

// firstVerb is `first((., norm) | (fmatch, xmatch) | select(startswith(p…)))`.
func (g *guard) firstVerb(cmd string, prefixes ...string) string {
	out := ""
	take := func(r string) bool {
		for _, p := range prefixes {
			if strings.HasPrefix(r, p) {
				out = r
				return true
			}
		}
		return false
	}
	for _, s := range []string{cmd, norm(cmd)} {
		if g.fmatch(s, take) || g.xmatch(s, take) {
			return out
		}
	}
	return ""
}

// fmatchFirst is `first(fmatch)`.
func (g *guard) fmatchFirst(s string) string {
	out := ""
	g.fmatch(s, func(r string) bool { out = r; return true })
	return out
}

// ── the quiz row ──

var (
	qzp     = `(?:` + wb + `ccrc-api['"]?` + sp + `+` + flags + `|` + expv + `)quiz` + sp + `+` + flags
	qzVerbs = []string{"record", "confirm", "status"}
	qzRes   = regexFamily(qzVerbs, func(v string) string { return qzp + v + nwEnd })
	qzExp   = re(qzp + exp)
	qzrA    = re(wb + `ccrc['"]?` + sp + `+` + flags + `quiz-record` + btEnd)
	qzrX    = re(expv + `quiz-record` + btEnd)
	qzhA    = re("(?:\\A|[" + wsc + ";&|()`'\"=]|/\\.local/bin/)ccrc-quiz-record" + btEnd)
	qzhB    = re("(?:\\A|[\\n;&|(`]|\\$\\()" + sp + `*(?:env(?:` + sp + `+(?:-` + ns + `+(?:` + sp + `+[A-Za-z_][A-Za-z0-9_]*)?|[A-Za-z_][A-Za-z0-9_]*=` + ns + `*))*` + sp +
		`+)?(?:(?:bash|sh)` + sp + `+` + flags + `)?['"]?` + "[^" + wsc + ";&|()`'\"]*/ccrc-quiz-record" + btEnd)
)

func (g *guard) qzmatch(s string) string {
	if !strings.Contains(s, "quiz") {
		return ""
	}
	for i, v := range qzVerbs {
		if qzRes[i]().MatchString(s) {
			return "quiz\tccrc-api quiz " + v
		}
	}
	if qzExp().MatchString(s) {
		return "quiz\tccrc-api quiz with its act in a variable"
	}
	if qzrA().MatchString(s) || (ccrcWord().MatchString(s) && qzrX().MatchString(s)) {
		return "quiz\tccrc quiz-record"
	}
	if qzhA().MatchString(s) || qzhB().MatchString(s) {
		return "quiz\tccrc-quiz-record"
	}
	return ""
}

// ── the account rows ──

var (
	dancT  = `(?:` + sepp + `|\A|` + lbDanc + `)`
	asecRe = re(dancT + `\.cc-secrets` + btEnd + `|` + dancT + `\.cc-sessions` + sepp + `\.door` + btEnd + `|` + dancT + `\.ccrc` + sepp +
		`(?:auth-scratch` + btEnd + `|agent\.env` + btEnd + `|linear(?:\.key)?` + btEnd + `|operator-secrets` + btEnd + `|operator-model\.db|privacy-journal\.log` + btEnd +
		`|privacy-journal\.torn` + btEnd + `|coordination-restore\.(?:stage|foreign)` + sepp + `[^` + wsc + `/;&|()<>]{1,64}` + sepp + `operator-model\.db|codex` + sepp +
		`[^` + wsc + `/;&|()<>]{1,64}` + sepp + `runtime\.env` + btEnd + `)|` + dancT + `ccrc-backups` + sepp + `[^` + wsc + `/;&|()<>]{1,64}` + sepp + `operator-model\.db`)
	awdAlts = dancAlts(`\.cc-sessions` + sepp + `\.(?:auth|accounts|door)` + btEnd)
	awdRe   = re(awdAlts.test())
	awdTail = newLastStart(awdAlts)
	arfAlts = dancAlts(`\.ccrc` + sepp + `accounts\.(?:json|sh)` + btEnd)
	arfRe   = re(arfAlts.test())
	arfTail = newLastStart(arfAlts)
	aoprun  = re(`\A` + sp + "*(?:[(`{]" + sp + `*){0,4}(?:(?:then|do|else|if|while|!)` + sp + `+){0,2}(?:[A-Za-z_][A-Za-z0-9_]*=` + ns + `*` + sp + `+){0,8}(?:(?:exec|env|time|nohup|command)` + sp +
		`+){0,2}(?:(?:` + ns + `*/)?(?:node|nodejs|bun|deno)` + sp + `+(?:-` + ns + `*` + sp + `+){0,8})?(?:` + ns + `*/)?account-op\.mjs` + btEnd)
	pmn     = `(?:operator-model\.db|privacy-journal\.(?:log|torn)` + btEnd + `)`
	pmnRe   = re(pmn)
	pmnComp = re(`(?:\A|[` + wsc + `/=])` + pmn)
	cdCcrc  = re(cdt(`\.ccrc`))
	pmex    = re(`\A` + sp + `*(?:ls|rm)` + nwEnd)
	pmbulk  = re(nbS + `(?:tar|zip|grep|rg)` + naEnd)
	pmcopy  = re(nbS + `(?:cp|rsync|scp)` + naEnd)
	// PMCPT, `NB cp NA [^\n]* (?:^|SP)(?:--target-directory|-[A-Za-z]*t[A-Za-z]*)(?=$|[=WS])`: NA's character is the
	// blank itself, or a character outside the word class and the newline that `[^\n]*` then starts from.
	pmcpt     = re(nbS + `cp(?:` + sp + `|[^A-Za-z0-9_\n][^\n]*` + sp + `)(?:--target-directory|-[A-Za-z]*t[A-Za-z]*)(?:\z|[=` + wsc + `])`)
	pdirCcrc  = re(dancT + `\.ccrc(?:/\.?){0,8}` + endAny)
	pdirCcrcW = re(dancT + `\.ccrc(?:/\.?){0,8}` + sp + `+[^` + wsc + meta + `]`)
	envs      = re("(?:\\$\\(|`)" + sp + "*(?:[^" + wsc + "/)`]*/)?(?:env|printenv)(?:" + sp + `+(?:-0|--null))*` + sp + "*[)`]")
	envb      = re(`\A` + sp + "*(?:(?:[(`{]|\\$\\()" + sp + `*){0,4}(?:[A-Za-z_][A-Za-z0-9_]{0,63}=` + ns + `*` + sp + `+){0,8}(?:exec` + sp + `+)?(?:` + ns + `*/)?(?:env|printenv)(?:` + sp +
		`+(?:-0|--null))*` + sp + "*[)`}]{0,4}" + sp + `*\z`)
	bshc = re(`\A` + sp + `*(?:` + ns + `*/)?(?:bash|sh)` + sp + `+-c` + sp + `+`)
)

// dancAlts is DANC + body, as a tail: `(?:SEPP|(?<![^WS=:'"]))body`.
func dancAlts(body string) tailAlts {
	return tailAlts{{"", sepp + body}, {lbDanc, body}}
}

// cdt is CDT($dir): `cd` or `pushd`, its flags, an anchor, the directory, then the command's end.
func cdt(dir string) string {
	return `(?:\A|[` + wsc + `(])(?:cd|pushd)` + sp + `+(?:-[PLe]{1,3}` + sp + `+){0,2}(?:(?:~|\$\{?HOME\}?|/[^` + wsc + `;&|()<>]{0,256}?)?` + sepp + `|\./)?` +
		dir + `/{0,8}` + endCmd
}

func (g *guard) apmatch(s string) string {
	if asecRe().MatchString(s) {
		return "account\ta secret or scratch path of a fleet account"
	}
	if pmnRe().MatchString(s) && cdthen(s, cdCcrc().MatchString, pmnRe().MatchString, pmnComp().MatchString) {
		return "account\tthe private store or its journal, after a cd into ~/.ccrc"
	}
	if strings.Contains(s, ".ccrc") {
		segs := segSplit(s)
		for _, seg := range segs {
			if !pmex().MatchString(seg) && pmglob(seg) {
				return "account\ta glob under ~/.ccrc that can match the private store or its journal"
			}
		}
		for _, seg := range segs {
			if (pmbulk().MatchString(seg) && pdirCcrc().MatchString(seg)) || (pmcopy().MatchString(seg) && pdirCcrcW().MatchString(seg)) ||
				(pmcpt().MatchString(seg) && pdirCcrc().MatchString(seg)) {
				return "account\ta copy or recursive read of ~/.ccrc, which holds the private store"
			}
		}
	}
	if awdRe().MatchString(s) && (hbt(segSplit(s), bwr, awdTail) || findw(s, awdRe().MatchString) || xargsw(s, awdRe().MatchString)) {
		return "account\ta write under the account state directories"
	}
	if arfRe().MatchString(s) && (hbt(segSplit(s), bwr, arfTail) || findw(s, arfRe().MatchString) || xargsw(s, arfRe().MatchString)) {
		return "account\ta write of the roster or its mirror"
	}
	if strings.Contains(s, "account-op") {
		for _, seg := range segSplit(s) {
			if aoprun().MatchString(seg) {
				return "account\ta direct run of the account script"
			}
		}
	}
	if strings.Contains(s, "env") {
		if envs().MatchString(s) {
			return "account\tprinting the whole environment"
		}
		for _, seg := range segSplit(s) {
			if envb().MatchString(seg) {
				return "account\tprinting the whole environment"
			}
			if m := bshc().FindStringIndex(seg); m != nil && envb().MatchString(seg[m[1]:]) {
				return "account\tprinting the whole environment"
			}
		}
	}
	return ""
}

// cdthen is `cdthen($cd; $gate; f)`: after the first segment with the `cd`, a later one for which f holds.
func cdthen(s string, cd, gate, f func(string) bool) bool {
	if !cd(s) || !gate(s) {
		return false
	}
	segs := segSplit(s)
	for k, seg := range segs {
		if cd(seg) {
			for _, later := range segs[k+1:] {
				if f(later) {
					return true
				}
			}
			return false
		}
	}
	return false
}

var (
	findRe   = re(nbS + `find` + naEnd)
	findAct  = re(sp + `-(?:delete|exec|execdir|ok|okdir)` + nwEnd)
	xargsRe  = re(nbS + `xargs` + naEnd)
	xargsHd  = re(`\A` + sp + `*xargs` + naEnd)
	interpRe = re(nbS + `(?:python[0-9.]{0,8}|node|perl|ruby|bun|deno)` + naEnd)
)

// findw is `findw($re)`.
func findw(s string, r func(string) bool) bool {
	if !findRe().MatchString(s) || !r(s) {
		return false
	}
	for _, seg := range segSplit(s) {
		if findRe().MatchString(seg) && r(seg) && findAct().MatchString(seg) {
			return true
		}
	}
	return false
}

// xargsw is `xargsw($re)`.
func xargsw(s string, r func(string) bool) bool {
	if !xargsRe().MatchString(s) || !r(s) {
		return false
	}
	for _, piece := range splitAny(s, "\n;&") {
		p := strings.Split(piece, "|")
		for k, x := range p {
			if r(x) {
				for _, y := range p[k+1:] {
					if xargsHd().MatchString(y) && bwr(y) {
						return true
					}
				}
				break
			}
		}
	}
	return false
}

// ── the paths of the edit and read tools ──

var (
	apsec = re(`/\.cc-secrets(?:/|\n?\z)|/\.cc-sessions/\.door(?:/|\n?\z)|/\.ccrc/auth-scratch(?:/|\n?\z)|/\.ccrc/codex/[^/]+/runtime\.env\n?\z|/\.ccrc/agent\.env\n?\z` +
		`|/\.ccrc/linear(?:/|\n?\z)|/\.ccrc/linear\.key\n?\z|/\.ccrc/operator-secrets(?:/|\n?\z)|/\.ccrc/operator-model\.db|/\.ccrc/privacy-journal\.log\n?\z` +
		`|/\.ccrc/privacy-journal\.torn(?:/|\n?\z)|/ccrc-backups/[^/]+/operator-model\.db|/\.ccrc/coordination-restore\.(?:stage|foreign)/[^/]+/operator-model\.db`)
	apwd    = re(`/\.cc-sessions/\.(?:auth|accounts|door)(?:/|\n?\z)`)
	aprf    = re(`/\.ccrc/accounts\.(?:json|sh)\n?\z`)
	pathf   = re(`/\.(?:cc-sessions|cc-limits|ccrc)` + btEnd + `|approval-signing|approval-verify\.mjs`)
	sensRe  = re(`(?:\A|/)(?:CLAUDE\.md|settings(?:\.local)?\.json|session-hook\.sh|/hooks/)`)
	buildRe = re(`/\.local/share/claude/versions` + btEnd + `|/\.local/bin/claude` + btEnd)
)

// pnorm is the program's `pnorm`: a leading `~/` is $ENV.HOME (or `~`), and an absolute path is folded (`//`, `/./`,
// `seg/..`).
func pnorm(p string, home *string) string {
	if strings.HasPrefix(p, "~/") {
		h := "~"
		if home != nil {
			h = *home
		}
		p = h + p[1:]
	}
	head := ""
	if !strings.HasPrefix(p, "/") {
		// D-TBD-go-hook-windows-home-fold: the core's HOME on Windows is `C:\…` where the bash's $ENV.HOME is MSYS2's `/c/…`,
		// so a `~/` path would go unfolded here and `~/.ccrc/./x` miss the deny the bash gives (measured). A drive-letter
		// path is folded from its first `/` on, the drive head kept as it is; a drive path in the payload itself, which the
		// bash leaves unfolded, is folded too (stricter).
		i := strings.IndexByte(p, '/')
		if len(p) < 2 || p[1] != ':' || !(p[0] >= 'A' && p[0] <= 'Z' || p[0] >= 'a' && p[0] <= 'z') || i < 0 {
			return p
		}
		head, p = p[:i], p[i:]
	}
	var keep []string
	for _, s := range strings.Split(p, "/") {
		switch s {
		case "", ".":
		case "..":
			if len(keep) > 0 {
				keep = keep[:len(keep)-1]
			}
		default:
			keep = append(keep, s)
		}
	}
	return head + "/" + strings.Join(keep, "/")
}

func acctpath(t string, in kernel.Obj, home *string) string {
	switch {
	case editTool(t):
		for _, p := range strs(in, "file_path", "notebook_path") {
			if q := pnorm(p, home); apsec().MatchString(q) || apwd().MatchString(q) || aprf().MatchString(q) {
				return "account\ta write to an account path"
			}
		}
	case t == "Read" || t == "Grep" || t == "Glob":
		for _, p := range readPaths(t, in) {
			if apsec().MatchString(pnorm(p, home)) {
				return "account\ta read of a secret or scratch path of a fleet account"
			}
		}
	}
	return ""
}

func pathwhy(t string, in kernel.Obj) string {
	for _, p := range strs(in, "file_path", "path", "notebook_path") {
		switch {
		case pathf().MatchString(p):
			return "other\ta forbidden path"
		case editTool(t) && sensRe().MatchString(p):
			return "other\tan edit to a settings file, a hook or a CLAUDE.md"
		case editTool(t) && buildRe().MatchString(p):
			return "other\ta write to a Claude Code build or its launcher"
		case t == "Read" && credTest().MatchString(p):
			return "other\treading a secret"
		}
	}
	return ""
}

// ── the deny file's upstream ids, and the build rows that read them ──

// guard is one run's state: the upstream ids `$ups` the deny file names, and the build rows' regexes built over them.
type guard struct {
	upre string // UPRE's alternation, "" for `(?!)`
	b    *buildRes
}

var upsRe = re(`\ABash\(([a-z][a-z0-9-]{0,31}) install:\*\)\n?\z`)

func newGuard(deny *string) *guard {
	var dl []string
	if deny != nil {
		if v, err := fromjsonLoose(kernel.JQRepair([]byte(*deny))); err == nil {
			if d, ok := get(v, "permissions", "deny").([]any); ok {
				for _, x := range d {
					if s, ok := x.(string); ok {
						dl = append(dl, s)
					}
				}
			}
		}
	}
	var ups []string
	for _, s := range dl {
		m := upsRe().FindStringSubmatch(s)
		if m == nil || m[1] == "claude" {
			continue
		}
		for _, u := range dl {
			if u == "Bash("+m[1]+" update:*)" {
				ups = append(ups, m[1])
				break
			}
		}
	}
	ups = uniqueSorted(ups)
	g := &guard{upre: strings.Join(ups, "|")}
	g.b = buildFor(g.upre)
	return g
}

var (
	buildMu    sync.Mutex
	buildCache = map[string]*buildRes{}
)

func buildFor(upre string) *buildRes {
	buildMu.Lock()
	defer buildMu.Unlock()
	if b, ok := buildCache[upre]; ok {
		return b
	}
	b := newBuildRes(upre)
	buildCache[upre] = b
	return b
}

func (g *guard) buildx() *regexp.Regexp { return g.b.buildx() }
func (g *guard) trust() *regexp.Regexp  { return g.b.trust() }

// fromjsonLoose is jq's `fromjson` as far as the deny file's strings go: jq's parser also takes a leading byte order
// mark and the number spellings C's strtod reads (`01`, `+1`, `.5`, `1.`, `nan`, `NaN`, `-nan`, `inf`, `Infinity`, `1e999`),
// measured on jq 1.7 and 1.8 (guard-denytext.golden). Each such scalar is read as null: only the strings of
// `.permissions.deny` are kept, and a number and a null leave the same strings (none) at every place one can stand.
func fromjsonLoose(s string) (any, error) {
	s = strings.TrimPrefix(s, "\ufeff")
	var b strings.Builder
	for i := 0; i < len(s); {
		c := s[i]
		if c == '"' {
			j := i + 1
			for j < len(s) && s[j] != '"' {
				if s[j] == '\\' {
					j++
				}
				j++
			}
			if j > len(s) {
				j = len(s)
			} else if j < len(s) {
				j++
			}
			b.WriteString(s[i:j])
			i = j
			continue
		}
		if strings.IndexByte(" \t\n\r{}[],:", c) >= 0 {
			b.WriteByte(c)
			i++
			continue
		}
		j := i
		for j < len(s) && strings.IndexByte(" \t\n\r{}[],:\"", s[j]) < 0 {
			j++
		}
		tok := s[i:j]
		if tok != "true" && tok != "false" && tok != "null" && strtodWhole().MatchString(tok) {
			tok = "null"
		}
		b.WriteString(tok)
		i = j
	}
	return kernel.JQParse([]byte(b.String()))
}

var strtodWhole = re(`\A[+-]?(?:(?i:inf|infinity|nan)|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)\z`)
