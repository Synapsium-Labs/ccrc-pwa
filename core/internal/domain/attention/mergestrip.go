package attention

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// MergeStrip is MERGE_STRIP_JQ (ccd/session-hook.sh), as `jq -r --arg q "'" --argjson cap MERGE_PARSE_CAP --arg allow
// ALLOW_ADMIN_RE` prints it for payload v: `=<flags>\x1f<stripped command>` for a command of at most cap UTF-8 bytes,
// `!<bytes>:<kinds>` (or "") over it, and ok false where jq errors (a command of another type, a tool_input that is no
// object), which the hook reads as no answer. The caller applies the `$( )` capture (cmdSubst).
//
// The strip is Oniguruma's: a regex of recursive groups (`\g<sub>`, `\g<pe>`, `\g<dq>`), atomic groups and possessive
// runs, backreferences (`\k<w>`), conditionals (`(?(<q>)…)`) and lookarounds, which RE2 cannot express. It is ported
// here group by group as ordered-choice scanners (stripScan): each method is one named group of DEFS, each tries the
// group's alternatives in the regex's order and commits as the atomic group does, and each names the construct it
// replaces. The over-cap kinds and the flags read plain regexes (ockinds, vflags).
func MergeStrip(v any) (string, bool) {
	c, err := path(v, "tool_input", "command")
	if err != nil {
		return "", false
	}
	c = or(c, "")
	cs, isStr := c.(string)
	if isStr && len(cs) > MergeParseCap {
		k := ockinds(cs)
		if k == "" {
			return "", true
		}
		return "!" + strconv.Itoa(len(cs)) + ":" + k, true
	}
	if !isStr { // `$c | vflags` reads it with split: an error on any other type
		return "", false
	}
	f := ""
	if equal(get(v, "tool_name"), "Bash") {
		f = qs(cs, true)
	}
	return "=" + vflags(cs) + "\x1f" + f, true
}

// MergeParseCap is MERGE_PARSE_CAP: the strip reads at most this many UTF-8 bytes of a command.
const MergeParseCap = 2048

// AllowAdminRE is ALLOW_ADMIN_RE (D-7249): the one admin-merge form the operator's allowance may lift. RE2 reads it as
// Oniguruma does (\A, \z and ASCII classes only).
const AllowAdminRE = `\A[ \t\n]*gh pr merge [0-9]+( --admin| --match-head-commit [0-9a-f]{40}| --squash| --merge| --rebase| --delete-branch| -d)*[ \t\n]*\z`

var (
	allowAdmin = re(AllowAdminRE)
	// mergepath: `[^[:space:]/]++/` is `[^[:space:]/]+/` (the run cannot hold the slash after it), and each
	// `(?![A-Za-z0-9_-])` at a pattern's end reads as one more character outside the class, or the end.
	mergePath = re(`pulls/[^` + onigS + `/]+/merge(?:[^A-Za-z0-9_-]|\z)|repos/[^` + onigS + `/]+/[^` + onigS + `/]+/merges(?:[^A-Za-z0-9_-]|\z)|pulls/[^;&|\n/]+/merge(?:[^A-Za-z0-9_-]|\z)|repos/[^;&|\n/]+/[^;&|\n/]+/merges(?:[^A-Za-z0-9_-]|\z)`)
	// ocafter's three heads. Each lookahead becomes a consumed character, and the cut is taken at the group's end, so
	// the text after it starts where the jq's does.
	ocGh    = re(`(?:\A|[^A-Za-z0-9_])(gh)[` + onigS + `]`)
	ocPr    = re(`[` + onigS + `](pr)(?:[` + onigS + `]|\z)`)
	ocMerge = re(`[` + onigS + "]merge(?:\\z|[" + onigS + "`()<>])")
	ocAPI   = re(`[` + onigS + "]api(?:\\z|[" + onigS + "`()<>])")
)

var mutWords = []string{"mergePullRequest", "enqueuePullRequest", "enablePullRequestAutoMerge", "mergeBranch"}

func mutword(s string) bool {
	for _, w := range mutWords {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

// unq is `split($q) | join("") | split("\"") | join("") | split("\\") | join("")`.
func unq(s string) string {
	return strings.NewReplacer("'", "", `"`, "", `\`, "").Replace(s)
}

// vflags: `a` names --admin, `s` is the allowance's one form, `w` names a merge mutation, `p` a merge path.
func vflags(c string) string {
	u := unq(c)
	f := ""
	if strings.Contains(c, "--admin") {
		f += "a"
	}
	if allowAdmin().MatchString(c) {
		f += "s"
	}
	if mutword(u) {
		f += "w"
	}
	if mergePath().MatchString(u) {
		f += "p"
	}
	return f
}

// ocafter is `ocafter($re)`: the text after the first match's group 1 ("" and false when none).
func ocafter(s string, r interface{ FindStringSubmatchIndex(string) []int }) (string, bool) {
	m := r.FindStringSubmatchIndex(s)
	if m == nil {
		return "", false
	}
	return s[m[3]:], true
}

// ocsplit is `ocsegs`: split on ;, &, | and newlines, empty pieces kept.
func ocsplit(s string) []string {
	var out []string
	b := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case ';', '&', '|', '\n':
			out = append(out, s[b:i])
			b = i + 1
		}
	}
	return append(out, s[b:])
}

func ocmerge(seg string) bool {
	a, ok := ocafter(seg, ocGh())
	if !ok {
		return false
	}
	b, ok := ocafter(a, ocPr())
	return ok && ocMerge().MatchString(b)
}

func ocapi(seg string) bool {
	a, ok := ocafter(seg, ocGh())
	return ok && ocAPI().MatchString(a)
}

// ockinds: what an over-cap command's raw text reads as, word by word: merge, admin (a merge naming --admin), api.
func ockinds(c string) string {
	m := false
	if strings.Contains(c, "gh") && strings.Contains(c, "merge") {
		for _, seg := range ocsplit(c) {
			if strings.Contains(seg, "gh") && strings.Contains(seg, "merge") && ocmerge(seg) {
				m = true
				break
			}
		}
	}
	a := false
	if strings.Contains(c, "gh") && strings.Contains(c, "api") {
		u := unq(c)
		if mutword(u) || strings.Contains(u, "/merge") {
			for _, seg := range ocsplit(c) {
				if strings.Contains(seg, "gh") && strings.Contains(seg, "api") && ocapi(seg) {
					a = true
					break
				}
			}
		}
	}
	var k []string
	if m {
		k = append(k, "merge")
		if strings.Contains(c, "--admin") {
			k = append(k, "admin")
		}
	}
	if a {
		k = append(k, "api")
	}
	return strings.Join(k, ",")
}

// plain: none of ' " \ # < ` (( $[.
func plain(s string) bool {
	for _, c := range []string{"'", `"`, `\`, "#", "<", "`", "((", "$["} {
		if strings.Contains(s, c) {
			return false
		}
	}
	return true
}

// stripScan holds one subject string and the flag the DEFS groups' `us`, `ud` and `ua` captures carry: an unclosed
// `$(`, `"` or `$'` that ran to the end of the text. They only ever match at the end, where every enclosing group
// accepts the end too, so a set flag is never undone by a later failure: one bool per match is the capture's answer.
//
// Two more facts are Oniguruma's own, measured (review F1, F2): a call of a named group (`\g<…>`, and the groups those
// calls reach) nests at most onigCallMax deep, past which the call fails as a non-match; and the capture `qs` (`qst`
// when dashed) of a heredoc inside `$(…)` stays set for the rest of the top-level match, so a later unquoted heredoc's
// conditional takes the quoted branch. depth counts the calls; qs and qst hold the quote, 0 while unset; both are undone
// when the construct that made them fails, and reset before each top-level match.
type stripScan struct {
	s       string
	open    bool
	depth   int
	qs, qst byte
}

// onigCallMax is Oniguruma's subexpression-call nesting limit as jq's build has it (measured: testdata's nest family).
const onigCallMax = 20

// call runs one named group's body as a call: past the nesting limit it fails, and a failure leaves the sticky
// captures as they were before it.
func (x *stripScan) call(body func() int) int {
	if x.depth >= onigCallMax {
		return -1
	}
	x.depth++
	qs, qst := x.qs, x.qst
	r := body()
	x.depth--
	if r < 0 {
		x.qs, x.qst = qs, qst
	}
	return r
}

// wordRun is W, `[^\s;&|()<>"'\\]+`: the end of the run at i (i when empty).
func (x *stripScan) wordRun(i int) int {
	s := x.s
	for i < len(s) {
		switch s[i] {
		case ';', '&', '|', '(', ')', '<', '>', '"', '\'', '\\':
			return i
		}
		r, n := utf8.DecodeRuneInString(s[i:])
		if isOnigS(r) {
			return i
		}
		i += n
	}
	return i
}

// escTail is `\\(?:.|\n|\z)`: a backslash and the character after it, or the backslash alone at the end.
func (x *stripScan) escTail(i int) int {
	if i+1 < len(x.s) {
		return i + 1 + runeLen(x.s, i+1)
	}
	return len(x.s)
}

// wordTail is `[^\s;&|()<>"'`\\$]*` from i.
func (x *stripScan) wordTail(i int) int {
	s := x.s
	for i < len(s) {
		switch s[i] {
		case ';', '&', '|', '(', ')', '<', '>', '"', '\'', '`', '\\', '$':
			return i
		}
		r, n := utf8.DecodeRuneInString(s[i:])
		if isOnigS(r) {
			return i
		}
		i += n
	}
	return i
}

// aq is AQ, `\$'(?>(?:[^\\']++|\\(?:.|\n|\z))*)(?:'|(?<ua>\z))`, at i (s[i:] starts `$'`): it always matches.
func (x *stripScan) aq(i int) int {
	s := x.s
	j := i + 2
	for j < len(s) && s[j] != '\'' {
		if s[j] == '\\' {
			j = x.escTail(j)
		} else {
			j++
		}
	}
	if j < len(s) {
		return j + 1
	}
	x.open = true
	return j
}

// sqOpen is `'[^']*+(?:'|\z)` at i: to the closing quote, or the end.
func (x *stripScan) sqOpen(i int) int {
	if k := strings.IndexByte(x.s[i+1:], '\''); k >= 0 {
		return i + 1 + k + 1
	}
	return len(x.s)
}

// btSpan is “ `(?>(?:[^`\\]++|\\(?:.|\n))*)` “ at i: a backtick, characters and escapes (a backslash at the very end
// stops it), the closing backtick. -1 when it does not close.
func (x *stripScan) btSpan(i int) int {
	s := x.s
	j := i + 1
	for j < len(s) && s[j] != '`' {
		if s[j] == '\\' {
			if j+1 >= len(s) {
				return -1
			}
			j += 1 + runeLen(s, j+1)
		} else {
			j++
		}
	}
	if j < len(s) {
		return j + 1
	}
	return -1
}

// ar is AR, `(?>(?:[^()\n]++|\((?>(?:[^()\n]++|\([^()\n]*+\))*)\))*)`, the arithmetic body: it always matches.
func (x *stripScan) ar(i int) int {
	s := x.s
	notParen := func(c byte) bool { return c != '(' && c != ')' && c != '\n' }
	for i < len(s) {
		if notParen(s[i]) {
			for i < len(s) && notParen(s[i]) {
				i++
			}
			continue
		}
		if s[i] != '(' {
			return i
		}
		k := i + 1
		for k < len(s) {
			if notParen(s[k]) {
				for k < len(s) && notParen(s[k]) {
					k++
				}
				continue
			}
			if s[k] != '(' {
				break
			}
			m := k + 1
			for m < len(s) && notParen(s[m]) {
				m++
			}
			if m < len(s) && s[m] == ')' {
				k = m + 1
				continue
			}
			break
		}
		if k < len(s) && s[k] == ')' {
			i = k + 1
			continue
		}
		return i
	}
	return i
}

// sub is DEFS's `sub`: `\$\(\(AR\)\)|\$\((?<sb>…)(?:\)|(?<us>\z))`, at i. -1 when neither alternative matches.
func (x *stripScan) sub(i int) int { return x.call(func() int { return x.subBody(i) }) }

func (x *stripScan) subBody(i int) int {
	s := x.s
	if !strings.HasPrefix(s[i:], "$(") {
		return -1
	}
	if strings.HasPrefix(s[i:], "$((") {
		if j := x.ar(i + 3); strings.HasPrefix(s[j:], "))") {
			return j + 2
		}
	}
	j := x.sbCall(i + 2)
	if j < 0 {
		return -1
	}
	if j < len(s) && s[j] == ')' {
		return j + 1
	}
	if j == len(s) {
		x.open = true
		return j
	}
	return -1
}

// sbCall is the `sb` group entered as a call (inline in `sub`, or `\g<sb>`).
func (x *stripScan) sbCall(j int) int { return x.call(func() int { return x.sb(j) }) }

// sb is the `sb` group's atomic loop, its alternatives in the regex's order; it always matches (possibly empty).
func (x *stripScan) sb(j int) int {
	s := x.s
	for j < len(s) {
		c := s[j]
		switch {
		case !strings.ContainsRune("'\"()\\<#$", rune(c)): // [^'"()\\<#$]++
			for j < len(s) && !strings.ContainsRune("'\"()\\<#$", rune(s[j])) {
				j++
			}
		case c == '$':
			switch {
			case strings.HasPrefix(s[j:], "$$"):
				j += 2
			case strings.HasPrefix(s[j:], "$'"):
				j = x.aq(j)
			default:
				if k := x.pe(j); k >= 0 { // \g<pe>
					j = k
				} else {
					j++ // \$
				}
			}
		case c == '\\': // \\(?:.|\n|\z)[^\s;&|()<>"'`\\$]*
			j = x.wordTail(x.escTail(j))
		case c == '<':
			if k := x.heredoc(j, true); k >= 0 { // \g<hs>
				j = k
			} else if strings.HasPrefix(s[j:], "<<") && !after(s, j, '<') && !strings.HasPrefix(s[j+2:], "<") {
				j = len(s) // (?<!<)<<(?!<)[\s\S]*
			} else {
				j++ // <
			}
		case c == '#':
			if commentStart(s, j) { // (?<![^\s;&|(])#[^\n]*
				j = lineEnd(s, j)
			} else {
				j++
			}
		case c == '\'':
			j = x.sqOpen(j)
		case c == '"':
			k := x.dq(j)
			if k < 0 {
				return j
			}
			j = k
		case c == '(':
			if strings.HasPrefix(s[j:], "((") { // \(\(AR\)\)
				if k := x.ar(j + 2); strings.HasPrefix(s[k:], "))") {
					j = k + 2
					continue
				}
			}
			qs, qst := x.qs, x.qst
			k := x.sbCall(j + 1) // \(\g<sb>(?:\)|\z)
			switch {
			case k < 0:
				return j
			case k < len(s) && s[k] == ')':
				j = k + 1
			case k == len(s):
				j = k
			default:
				x.qs, x.qst = qs, qst
				return j
			}
		default: // `)`
			return j
		}
	}
	return j
}

// pe is DEFS's `pe`, a parameter expansion `${…}` to its `}` or the end, at i. -1 when it does not match.
func (x *stripScan) pe(i int) int {
	if !strings.HasPrefix(x.s[i:], "${") {
		return -1
	}
	return x.call(func() int { return x.peBody(i) })
}

func (x *stripScan) peBody(i int) int {
	s := x.s
	if !strings.HasPrefix(s[i:], "${") {
		return -1
	}
	j := i + 2
loop:
	for j < len(s) {
		c := s[j]
		switch c {
		case '}':
			break loop
		case '\\':
			j = x.escTail(j)
		case '"':
			k := x.dq(j)
			if k < 0 {
				break loop
			}
			j = k
		case '\'':
			j = x.sqOpen(j)
		case '$':
			switch {
			case strings.HasPrefix(s[j:], "$$"):
				j += 2
			case strings.HasPrefix(s[j:], "$'"):
				j = x.aq(j)
			default:
				if k := x.sub(j); k >= 0 {
					j = k
				} else if k := x.pe(j); k >= 0 {
					j = k
				} else if j+1 < len(s) && (s[j+1] == '(' || s[j+1] == '{') {
					break loop // \$(?![({]) refuses it
				} else {
					j++
				}
			}
		case '`':
			if k := x.btSpan(j); k >= 0 {
				j = k
			} else {
				j++
			}
		default: // [^}"'\\$`]++
			for j < len(s) && !strings.ContainsRune("}\"'\\$`", rune(s[j])) {
				j++
			}
		}
	}
	if j < len(s) && s[j] == '}' {
		return j + 1
	}
	if j == len(s) {
		return j
	}
	return -1
}

// dq is DEFS's `dq`, a double-quoted span to its `"` or (`ud`) the end, at i. -1 when it does not match.
func (x *stripScan) dq(i int) int { return x.call(func() int { return x.dqBody(i) }) }

func (x *stripScan) dqBody(i int) int {
	s := x.s
	j := i + 1
loop:
	for j < len(s) {
		c := s[j]
		switch c {
		case '"':
			break loop
		case '\\':
			j = x.escTail(j)
		case '$':
			if k := x.pe(j); k >= 0 {
				j = k
			} else if j+1 >= len(s) || (s[j+1] != '(' && s[j+1] != '{') { // \$(?![({])
				j++
			} else if k := x.sub(j); k >= 0 {
				j = k
			} else {
				break loop
			}
		case '`':
			if k := x.btSpan(j); k >= 0 {
				j = k
			} else {
				j++
			}
		default: // [^"\\$`]++
			for j < len(s) && !strings.ContainsRune("\"\\$`", rune(s[j])) {
				j++
			}
		}
	}
	if j < len(s) && s[j] == '"' {
		return j + 1
	}
	if j == len(s) {
		x.open = true
		return j
	}
	return -1
}

// after is `(?<=c)` at i: the character before s[i] is c.
func after(s string, i int, c byte) bool { return i > 0 && s[i-1] == c }

// commentStart is `(?<![^\s;&|(])` at i: the start, or a blank, `;`, `&`, `|` or `(` before it.
func commentStart(s string, i int) bool {
	r, ok := prevRune(s, i)
	return !ok || isOnigS(r) || strings.ContainsRune(";&|(", r)
}

// lineEnd is `[^\n]*` from i.
func lineEnd(s string, i int) int {
	if k := strings.IndexByte(s[i:], '\n'); k >= 0 {
		return i + k
	}
	return len(s)
}

// heredoc is DEFS's `hd` (sub false) or `hs` (sub true) at i: `(?<!<)<<(?:-[ \t]*hd1(tabs)|[ \t]*hd1)`. -1 when it does
// not match.
func (x *stripScan) heredoc(i int, sub bool) int {
	if !strings.HasPrefix(x.s[i:], "<<") || after(x.s, i, '<') {
		return -1
	}
	return x.call(func() int { return x.heredocBody(i, sub) })
}

func (x *stripScan) heredocBody(i int, sub bool) int {
	s := x.s
	if !strings.HasPrefix(s[i:], "<<") || after(s, i, '<') {
		return -1
	}
	j := i + 2
	if j < len(s) && s[j] == '-' {
		if k := x.hd1(skipBlanks(s, j+1), true, sub); k >= 0 {
			return k
		}
	}
	return x.hd1(skipBlanks(s, j), false, sub)
}

func skipBlanks(s string, i int) int {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	return i
}

// hd1 is DEFS's hd1: the delimiter word (quoted, `(?<q>["'])` with `\k<q>` closing it under the conditional, or
// `\\?` and W), no other `<<` later on its line (`(?![^\n]*?(?<!<)<<(?!<))`), the rest of the line, then the body's
// lines up to one that is the terminator T (tabs, when dashed, then `\k<w>`, then the line's end or, inside `$(…)`, a
// `)`), and the terminator if it is there. -1 when it does not match.
func (x *stripScan) hd1(i int, tabs, sub bool) int {
	s := x.s
	var word string
	j := i
	qp := &x.qs // the capture this call's conditional reads: `qs`, `qst` when dashed (inside `$(…)` only)
	if tabs {
		qp = &x.qst
	}
	stale := byte(0)
	if sub {
		stale = *qp
	}
	fresh := byte(0)
	if j < len(s) && (s[j] == '"' || s[j] == '\'') {
		q := s[j]
		k := j + 1
		for k < len(s) && s[k] != '"' && s[k] != '\'' && s[k] != '\n' {
			k++
		}
		if k == j+1 || k >= len(s) || s[k] != q {
			return -1 // the `\\?` alternative cannot start at a quote, either branch
		}
		word, j, fresh = s[j+1:k], k+1, q
	} else {
		ok := false
		for _, w := range []int{j + 1, j} { // `\\?` greedy: the backslash taken first
			if w == j+1 && !(j < len(s) && s[j] == '\\') {
				continue
			}
			if stale != 0 {
				// the conditional reads an earlier call's capture: `[^"'\n]+` then `\k<q>`, that quote
				e := w
				for e < len(s) && s[e] != '"' && s[e] != '\'' && s[e] != '\n' {
					e++
				}
				if e > w && e < len(s) && s[e] == stale {
					word, j, ok = s[w:e], e+1, true
					break
				}
				continue
			}
			if e := x.wordRun(w); e > w {
				word, j, ok = s[w:e], e, true
				break
			}
		}
		if !ok {
			return -1
		}
	}
	le := lineEnd(s, j)
	for p := j; p+1 < le; p++ {
		if s[p] == '<' && s[p+1] == '<' && !after(s, p, '<') && !(p+2 < len(s) && s[p+2] == '<') {
			return -1
		}
	}
	j = le
	if j < len(s) {
		j++
	}
	// the body, atomic: lines that are not the terminator, then a last line with no newline
	for j < len(s) {
		if _, ok := x.term(j, word, tabs, sub); ok {
			break
		}
		nl := strings.IndexByte(s[j:], '\n')
		if nl < 0 {
			j = len(s)
			break
		}
		j += nl + 1
	}
	if e, ok := x.term(j, word, tabs, sub); ok {
		j = e
	}
	if sub && fresh != 0 {
		*qp = fresh
	}
	return j
}

// term is T at j: tabs (greedy, when dashed), the word, and the end assertion. It answers where T ends.
func (x *stripScan) term(j int, word string, tabs, sub bool) (int, bool) {
	s := x.s
	m := 0
	if tabs {
		for j+m < len(s) && s[j+m] == '\t' {
			m++
		}
	}
	for k := m; k >= 0; k-- {
		e := j + k
		if !strings.HasPrefix(s[e:], word) {
			continue
		}
		e += len(word)
		if e == len(s) || s[e] == '\n' || (sub && s[e] == ')') {
			return e, true
		}
	}
	return 0, false
}

// qsTop is the top strip's alternatives at i, in the regex's order (h adds the heredoc and the bare `<<`): the match's
// end, or -1.
func (x *stripScan) qsTop(i int, h bool) int {
	s := x.s
	c := s[i]
	switch c {
	case '\\': // \\.[^\s;&|()<>"'`\\$]*
		if i+1 < len(s) && s[i+1] != '\n' {
			return x.wordTail(i + 1 + runeLen(s, i+1))
		}
		return -1
	case '$':
		switch {
		case strings.HasPrefix(s[i:], "$$"):
			return i + 2
		case strings.HasPrefix(s[i:], "$'"):
			return x.aq(i)
		case strings.HasPrefix(s[i:], "$(("):
			if k := x.ar(i + 3); strings.HasPrefix(s[k:], "))") {
				return k + 2
			}
		case strings.HasPrefix(s[i:], "$["):
			if k := strings.IndexAny(s[i+2:], "]\n"); k >= 0 && s[i+2+k] == ']' {
				return i + 2 + k + 1
			}
		}
		return -1
	case '\'': // SQ, closed
		if k := strings.IndexByte(s[i+1:], '\''); k >= 0 {
			return i + 1 + k + 1
		}
		return -1
	case '"':
		return x.dq(i)
	case '<':
		if !h {
			return -1
		}
		if k := x.heredoc(i, false); k >= 0 {
			return k
		}
		if strings.HasPrefix(s[i:], "<<") && !after(s, i, '<') && !strings.HasPrefix(s[i+2:], "<") {
			return i + 2
		}
		return -1
	case '#':
		if commentStart(s, i) {
			return lineEnd(s, i)
		}
		return -1
	case '(':
		if strings.HasPrefix(s[i:], "((") {
			if k := x.ar(i + 2); strings.HasPrefix(s[k:], "))") {
				return k + 2
			}
		}
		return -1
	}
	return -1
}

// substTop is the `subs` strip's alternatives at i: `\\(?:.|\n)|\g<sub>|[^\\$]+|\$`.
func (x *stripScan) substTop(i int) int {
	s := x.s
	switch s[i] {
	case '\\':
		if i+1 < len(s) {
			return i + 1 + runeLen(s, i+1)
		}
		return -1
	case '$':
		if k := x.sub(i); k >= 0 {
			return k
		}
		return i + 1
	}
	k := i
	for k < len(s) && s[k] != '\\' && s[k] != '$' {
		k++
	}
	return k
}

// fs is the program's `fs(re; f)`: f over each match (its text and whether it ran open to the end), the text between
// kept; the first match f answers null for (ok false) keeps the raw text from that match on.
func fs(s string, at func(x *stripScan, i int) int, f func(m string, open bool) (string, bool)) string {
	x := &stripScan{s: s}
	var out strings.Builder
	prev := 0
	matched := false
	for i := 0; i < len(s); {
		x.open, x.depth, x.qs, x.qst = false, 0, 0, 0
		e := at(x, i)
		if e < 0 {
			i += runeLen(s, i)
			continue
		}
		matched = true
		r, ok := f(s[i:e], x.open)
		if !ok {
			out.WriteString(s[prev:i])
			out.WriteString(s[i:])
			return out.String()
		}
		out.WriteString(s[prev:i])
		out.WriteString(r)
		prev, i = e, e
	}
	if !matched {
		return s
	}
	out.WriteString(s[prev:])
	return out.String()
}

// qs is the program's `qs($h)`: quoted spans removed, a double-quoted span's `$(…)` kept and stripped in turn, a
// readable unquoted heredoc's body kept for its substitutions, an unfinished span kept as it is, and from a heredoc it
// cannot read (or a bare `<<`) on, the raw text.
func qs(s string, h bool) string {
	if plain(s) {
		return s
	}
	return fs(s, func(x *stripScan, i int) int { return x.qsTop(i, h) }, func(m string, open bool) (string, bool) {
		switch {
		case open:
			return m, true
		case strings.HasPrefix(m, `"`):
			return subs(dropLastRune(m[1:])), true
		case m == "<<":
			return "", false
		case strings.HasPrefix(m, "<<"):
			return heredocText(m)
		case strings.HasPrefix(m, "$((") || strings.HasPrefix(m, "((") || strings.HasPrefix(m, "$[") || strings.HasPrefix(m, "$$"):
			return m, true
		}
		return "", true
	})
}

// subs is the program's `subs`: a double-quoted span's text kept only for its command substitutions.
func subs(t string) string {
	if !strings.Contains(t, "$(") {
		return ""
	}
	if strings.HasPrefix(t, "$(") && strings.HasSuffix(t, ")") {
		in := t[2 : len(t)-1]
		if plain(in) && !strings.ContainsAny(in, "()$") {
			return t
		}
	}
	return fs(t, func(x *stripScan, i int) int { return x.substTop(i) }, func(m string, open bool) (string, bool) {
		switch {
		case !strings.HasPrefix(m, "$("):
			return "", true
		case open, strings.HasPrefix(m, "$(("):
			return m, true
		}
		return "$(" + qs(m[2:len(m)-1], true) + ")", true
	})
}

// heredocText is the heredoc arm of qs's f: `capture("^<<(?<d>-?)[ \\t]*(?:(?<q>[\"'])(?<w>[^\"'\\n]+)\\k<q>|(?<x>\\\\?)
// (?<w2>W))(?<r>[^\\n]*)(?<b>[\\s\\S]*)")` read with its backtracking (the dash taken first, then not), and the
// heredoc kept only when it closes on its last line and nothing in it reads as another span.
func heredocText(m string) (string, bool) {
	x := &stripScan{s: m}
	var word, r, b string
	quoted, esc, dash, found := false, false, false, false
	for _, d := range []bool{true, false} {
		k := 2
		if d {
			if !strings.HasPrefix(m[2:], "-") {
				continue
			}
			k = 3
		}
		k = skipBlanks(m, k)
		var e int
		if k < len(m) && (m[k] == '"' || m[k] == '\'') {
			q := m[k]
			e = k + 1
			for e < len(m) && m[e] != '"' && m[e] != '\'' && m[e] != '\n' {
				e++
			}
			if e == k+1 || e >= len(m) || m[e] != q {
				continue
			}
			word, quoted, esc, e = m[k+1:e], true, false, e+1
		} else {
			w := k
			esc = false
			if k < len(m) && m[k] == '\\' {
				w, esc = k+1, true
			}
			e = x.wordRun(w)
			if e == w {
				continue
			}
			word, quoted = m[w:e], false
		}
		le := lineEnd(m, e)
		r, b, dash, found = m[e:le], m[le:], d, true
		break
	}
	if !found {
		return "", false
	}
	last := m[strings.LastIndexByte(m, '\n')+1:]
	if dash {
		last = trimTabs(last)
	}
	rest := qs(r, false)
	done := strings.Contains(b, "\n") && last == word && !strings.ContainsAny(rest, "\"'`")
	if done {
		wp := word + ")"
		for _, l := range strings.Split(b, "\n") {
			if dash {
				l = trimTabs(l)
			}
			if strings.HasPrefix(l, wp) {
				done = false
				break
			}
		}
	}
	if !done {
		return "", false
	}
	body := ""
	if !esc && !quoted {
		body = subs(b)
	}
	return "<<" + rest + "\n" + body, true
}
