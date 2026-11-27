package attention

import (
	"strings"
	"unicode/utf8"
)

// The prune row (`pmatch`, cleanup un-wedge Task R3, review 1479 and 1493): a `git worktree prune` refused on every
// session, relaxed only for a complete, modeled text-only mention (`qmodel`, `qread`, `hdocs`, `qscan`).

const (
	qch = `['"\\$\n]*`
	// GVAL, `(?:A1|A2|A3|A4|A5|C|\$(?!\())+`: a bare `$` whose next character is `(` is refused by the lookahead, and in
	// every place GVAL stands a blank follows it, so the lookahead only ever looks at the next token. The rewrite is that
	// language with the lookahead gone: runs of bare `$` followed by a token that does not start with `(` (P or Cn), or
	// ending the value.
	gvalP  = "\\$\\([^()\\n]*\\)|`[^`\\n]*`|'[^']*'|\"(?:[^\"\\\\]|\\\\(?s:.))*\"|\\\\(?s:.)"
	gvalC  = "[^" + wsc + "`$'\"\\\\;|&]"
	gvalCn = "[^" + wsc + "`$'\"\\\\;|&(]"
	gval   = `(?:(?:` + gvalP + `|` + gvalC + `|\$+(?:` + gvalP + `|` + gvalCn + `))+(?:\$+)?|\$+)`
	// a wrapper and its flags; GITPRE's `(?:wrapper){0,4}` is written as four optional copies, because RE2 refuses a
	// `{0,256}` nested in a `{0,4}` (its nested counts multiply past 1000): the same language, each copy taken greedily
	gitwrap = `(?:(?:` + ns + `{0,256}/)?(?:sudo|env|command|exec|nohup|nice|time|timeout|bash|sh|zsh|dash)` + sp + `+(?:(?:-[A-Za-z]*[oO]` + sp + `+` + gval + `|-` + ns +
		`*|[A-Za-z_][A-Za-z0-9_]*=(?:` + gval + `)?|[0-9][0-9.]*[smhd]?)` + sp + `+){0,8})?`
	gitpre = "(?:\\A|\\$\\(|[(`{])" + sp + `*(?:(?:then|do|else|elif|if|while|until|!)` + sp + `+){0,4}(?:[A-Za-z_][A-Za-z0-9_]*=(?:` + gval + `)?` + sp + `+){0,8}` +
		gitwrap + gitwrap + gitwrap + gitwrap + `(?:` + ns + `{0,256}/)?git` + sp + `+`
	gopt = `(?:-[Cc]` + sp + `+` + gval + `|--(?:git-dir|work-tree|namespace|config-env|attr-source)(?:=(?:` + gval + `)?|` + sp + `+` + gval + `)|--exec-path(?:=(?:` + gval +
		`)?)?|--(?:no-pager|paginate|bare|no-replace-objects|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-optional-locks|no-lazy-fetch|no-advice)|-[pP])` + sp + `+`
	// GITWT ends `prune NW (?<rest>[^#]*)`: NW's character is rest's first, or rest is empty at a `#` or the end.
	gitwt = gitpre + `(?:` + gopt + `){0,8}worktree` + sp + `+` + flags + `prune(?:([^#A-Za-z0-9_-][^#]*)|\z|#)`
	qsepq = `[` + wsc + `;&|()<>'"\\]`
	qsep  = "[" + wsc + ";&|()<>`$'\"\\\\]"
	shn   = `(?:` + ns + `{0,256}/)?(?:ba|z|da|k)?sh`
)

var (
	panc    = re(`p` + qch + `r` + qch + `u` + qch + `n` + qch + `e`)
	wanc    = re(`w` + qch + `o` + qch + `r` + qch + `k` + qch + `t` + qch + `r` + qch + `e` + qch + `e`)
	gitwtRe = re(gitwt)
	glast   = re(`\A(?s:.*)(?:\A|` + sp + `)(-n|--dry-run|--no-d(?:r(?:y(?:-(?:r(?:u(?:n)?)?)?)?)?)?)(?:\z|[` + wsc + `)])`)
	qtok    = re(`\$'(?:[^'\\]|\\(?s:.))*'?|\$?"(?:[^"\\]|\\(?s:.))*"?|'[^']*'?|\\(?s:.)?|[^"'\\$]+|\$`)
	cmtRe   = re(`(?:\A|[` + wsc + `;&|(])#`)
	sqClose = re(`\A'[^']*'\n?\z`)
	aqClose = re(`\A\$'(?:[^'\\]|\\(?s:.))*'\n?\z`)
	dqClose = re(`\A\$?"(?:[^"\\]|\\(?s:.))*"\n?\z`)
	dqLine  = re(`\A(?:[^"\\]|\\(?s:.))*"`)
	openSub = re(`\$\([^)]*\n?\z`)
	hdopW   = re(`\A(?:'[^']*'|"(?:[^"\\]|\\(?s:.))*"|\\(?s:.)|[^` + wsc + `;&|()<>'"\\])+`)
	hdw     = re(`\A(?:'[A-Za-z0-9_.-]*'|"[A-Za-z0-9_.-]*"|\\[A-Za-z0-9_.-]|[A-Za-z0-9_.-])+\n?\z`)
	shany   = re(`(?:\A|[` + wsc + `;&|(])(?:` + ns + `{0,256}/)?(?:ba|z|da|k|s)?sh(?:\z|[` + wsc + `;&|)])`)
	srcRe   = re(`(?:\A|[` + wsc + `;&|(])(?:source|\.)` + sp + `+`)
	bsEnd   = re(`\\\n?\z`)
	unsafe  = re(`\r\n|\\\n|\|[` + onigSNoNL + `]*\n|\n[` + onigSNoNL + `]*\||\}[` + onigS + `]*\|`)
	textb   = re("\\\\(?s:.)|(\\$\\([^()\\n]*\\)|`[^`\\n]*`)|[^\\\\$`]+|[$`]")
	dqcRe   = re("(\\$\\([^()]*\\)|`[^`]*`)|\\\\((?s:.))|(" + qsepq + ")")
	qsepqRe = re(qsepq)
	qsepRe  = re(qsep)
	shcRe   = re(`(?:\A|[` + wsc + `;&|(])` + shn + `(?:` + sp + `+-[A-Za-z]+){0,4}` + sp + `+-[A-Za-z]*c[A-Za-z]*` + sp + `+\z`)
	shchRe  = re(`(?:\A|[` + wsc + `;&|(])` + shn + sp + `+[^\n;&|]*-[A-Za-z]*c[A-Za-z]*(?:\z|[` + wsc + `])`)
	shcdRe  = re(`(?:\A|[` + wsc + `;&|(])` + shn + sp + `+-[A-Za-z]*c[A-Za-z]*` + sp + `+\z`)
	nextOK  = re(`\A(?:[` + onigSNoNL + `]*\n?\z|[` + onigSNoNL + `]*[\n;&|])`)
	dqSubRe = re("\\$\\([^)]*[('(]|`[^`]*[()']")
)

func pmatch(s string) bool {
	if !strings.Contains(s, "p") || !strings.Contains(s, "w") {
		return false
	}
	both := false
	for _, seg := range splitAny(s, ";&|") {
		if panc().MatchString(seg) && wanc().MatchString(seg) {
			both = true
			break
		}
	}
	if !both || !(gprune(s) || pplain(s)) {
		return false
	}
	return !qmodel(s) || panc().MatchString(qread(s, 1, true)) || gprune(qread(s, 1, false))
}

// gprune is the program's `gprune`.
func gprune(s string) bool {
	for _, seg := range splitAny(s, "\n;&|") {
		if !strings.Contains(seg, "prune") || !strings.Contains(seg, "worktree") {
			continue
		}
		m := gitwtRe().FindStringSubmatchIndex(seg)
		if m == nil {
			continue
		}
		rest := ""
		if m[2] >= 0 {
			rest = seg[m[2]:m[3]]
		}
		r := norm(rest)
		f := ""
		found := false
		if g := glast().FindStringSubmatchIndex(r); g != nil {
			f, found = r[g[2]:g[3]], true
		}
		if strings.ContainsAny(r, "$<>`") || !found || strings.HasPrefix(f, "--no-d") {
			return true
		}
	}
	return false
}

// pplain is the program's `pplain`.
func pplain(s string) bool {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) && s[i+1] == '\n' {
			i++
			continue
		}
		b.WriteByte(s[i])
	}
	for _, seg := range splitAny(b.String(), "\n;&|") {
		if panc().MatchString(seg) && wanc().MatchString(seg) && gprune(norm(seg)) {
			return true
		}
	}
	return false
}

// hdop is one match of HDOP, `(?<![<])<<(?<dash>-?)(?![<])[ \t]*(?<w>…)`: its offset and length, its dash, its word.
type hdop struct {
	off, n int
	dash   bool
	w      string
}

// hdopAt is HDOP at i, the dash taken first and then not, as the backtracking reads it.
func hdopAt(s string, i int) (hdop, bool) {
	if !strings.HasPrefix(s[i:], "<<") || after(s, i, '<') {
		return hdop{}, false
	}
	try := func(j int, dash bool) (hdop, bool) {
		if j < len(s) && s[j] == '<' {
			return hdop{}, false
		}
		k := skipBlanks(s, j)
		m := hdopW().FindStringIndex(s[k:])
		if m == nil {
			return hdop{}, false
		}
		return hdop{off: i, n: k + m[1] - i, dash: dash, w: s[k : k+m[1]]}, true
	}
	if j := i + 2; j < len(s) && s[j] == '-' {
		if h, ok := try(j+1, true); ok {
			return h, true
		}
	}
	return try(i+2, false)
}

// hdops is `match(HDOP; "g")`.
func hdops(s string) []hdop {
	var out []hdop
	for i := 0; i < len(s); {
		if h, ok := hdopAt(s, i); ok {
			out = append(out, h)
			i = h.off + h.n
			continue
		}
		i++
	}
	return out
}

type qtoken struct {
	o, n int
	s, k string
}

func qkind(s string) string {
	switch {
	case strings.HasPrefix(s, "$'"):
		return "a"
	case strings.HasPrefix(s, `"`), strings.HasPrefix(s, `$"`):
		return "h"
	case strings.HasPrefix(s, "'"):
		return "s"
	case strings.HasPrefix(s, `\`):
		return "e"
	}
	return "p"
}

func qtokens(s string) []qtoken {
	var out []qtoken
	for _, m := range qtok().FindAllStringIndex(s, -1) {
		out = append(out, qtoken{o: m[0], n: m[1] - m[0], s: s[m[0]:m[1]], k: qkind(s[m[0]:m[1]])})
	}
	return out
}

// qscan is the program's `qscan($q0)` over one line: the quote open at its end, and its heredoc operator in code.
func qscan(l, q0 string) (string, *hdop) {
	st := 0
	switch q0 {
	case "s":
		k := strings.IndexByte(l, '\'')
		if k < 0 {
			return q0, nil
		}
		st = k + 1
	case "d":
		m := dqLine().FindStringIndex(l)
		if m == nil {
			return q0, nil
		}
		st = m[1]
	}
	c := l[st:]
	t := qtokens(c)
	cm := -1
	for _, x := range t {
		if x.k != "p" {
			continue
		}
		if m := cmtRe().FindStringIndex(x.s); m != nil {
			cm = x.o + m[0]
			break
		}
	}
	var h *hdop
	if hs := firstHdop(c); hs != nil {
		h = hs
	}
	var z *qtoken
	for i := range t {
		if cm < 0 || t[i].o < cm {
			z = &t[i]
		}
	}
	q := ""
	if z != nil {
		switch {
		case z.k == "s" && !sqClose().MatchString(z.s), z.k == "a" && !aqClose().MatchString(z.s):
			q = "s"
		case z.k == "h" && !dqClose().MatchString(z.s):
			q = "d"
		}
	}
	if h != nil && (cm < 0 || h.off < cm) {
		for _, x := range t {
			if x.o <= h.off && h.off < x.o+x.n && (x.k == "p" || (x.k == "h" && openSub().MatchString(x.s[:h.off-x.o]))) {
				r := *h
				r.off += st
				return q, &r
			}
		}
	}
	return q, nil
}

func firstHdop(s string) *hdop {
	for i := 0; i < len(s); i++ {
		if h, ok := hdopAt(s, i); ok {
			return &h
		}
	}
	return nil
}

// hdocs is the program's `hdocs`: the command with its heredoc bodies read as text (or dropped, or fed to a shell as
// code), and whether the reading is one the proof may use.
func hdocs(s string) (string, bool) {
	if !strings.Contains(s, "<<") {
		return s, true
	}
	ls := strings.Split(s, "\n")
	n := 0
	for _, l := range ls {
		if firstHdop(l) != nil {
			n++
		}
	}
	if n > 16 {
		return s, false
	}
	m, d, tabs, q, bad, ok := "code", "", false, "", false, true
	outs := make([]string, 0, len(ls))
	for _, l := range ls {
		o := ""
		switch {
		case m == "code":
			var h *hdop
			q, h = qscan(l, q)
			o = l
			if h != nil {
				ok = ok && !(bsEnd().MatchString(l) || len(hdops(l)) > 1 || srcRe().MatchString(l))
				if !hdw().MatchString(h.w) {
					bad = true
				} else {
					d = strings.NewReplacer("'", "", `"`, "", `\`, "").Replace(h.w)
					tabs = h.dash
					switch {
					case shany().MatchString(l[:h.off] + " " + l[h.off+h.n:]):
						m = "fed"
					case strings.ContainsAny(h.w, `'"\`):
						m = "drop"
					default:
						m = "text"
					}
				}
			}
		case func() bool {
			x := l
			if tabs {
				x = trimTabs(l)
			}
			return x == d
		}():
			o, m = l, "code"
		case m == "fed":
			o = l
		case m == "text":
			o = textB(l)
		}
		outs = append(outs, o)
	}
	bad = bad || m != "code"
	out := s
	if !bad {
		out = strings.Join(outs, "\n")
	}
	return out, ok && !bad && !unsafe().MatchString(out)
}

// textB is TEXTB: the command substitutions of a text, joined by blanks.
func textB(s string) string {
	var p []string
	for _, m := range textb().FindAllStringSubmatchIndex(s, -1) {
		if m[2] >= 0 {
			p = append(p, s[m[2]:m[3]])
		}
	}
	return strings.Join(p, " ")
}

// dqc is DQC.
func dqc(s string) string {
	var b strings.Builder
	prev := 0
	for _, m := range dqcRe().FindAllStringSubmatchIndex(s, -1) {
		b.WriteString(s[prev:m[0]])
		switch {
		case m[2] >= 0:
			b.WriteString(s[m[2]:m[3]])
		case m[4] >= 0:
			c := s[m[4]:m[5]]
			switch {
			case c == "\n":
			case qsepqRe().MatchString(c):
				b.WriteString("_")
			default:
				b.WriteString(c)
			}
		default:
			b.WriteString("_")
		}
		prev = m[1]
	}
	b.WriteString(s[prev:])
	return b.String()
}

func lastRuneWS(s string) bool {
	r, n := utf8.DecodeLastRuneInString(s)
	return n > 0 && isWS(r)
}

func firstRuneIn(s string, extra string) bool {
	r, n := utf8.DecodeRuneInString(s)
	return n > 0 && (isWS(r) || strings.ContainsRune(extra, r))
}

// qread is the program's `qread($d; $proof)`: the command with each quoted span read as one word of text (or, `bash -c`'s
// string, as code one level deep).
func qread(s string, d int, proof bool) string {
	h, _ := hdocs(s)
	t := qtokens(h)
	var b strings.Builder
	for i, x := range t {
		switch x.k {
		case "p":
			b.WriteString(x.s)
			continue
		case "e":
			c := x.s[1:]
			switch {
			case c == "" || c == "\n":
			case qsepqRe().MatchString(c):
				b.WriteString("_")
			default:
				b.WriteString(c)
			}
			continue
		}
		var c string
		switch x.k {
		case "a":
			if utf8.RuneCountInString(x.s) >= 3 && strings.HasSuffix(x.s, "'") {
				c = x.s[2 : len(x.s)-1]
			} else {
				c = x.s[2:]
			}
		case "s":
			c = strings.TrimPrefix(x.s, "'")
			if strings.HasSuffix(c, "'") {
				c = c[:len(c)-1]
			}
		default:
			c = strings.TrimPrefix(x.s, "$")[1:]
			if strings.HasSuffix(c, `"`) {
				c = c[:len(c)-1]
			}
		}
		switch {
		case d > 0 && i > 0 && t[i-1].k == "p" && shcRe().MatchString(t[i-1].s):
			b.WriteString(qread(c, d-1, proof))
		case c == "":
			if (i == 0 || lastRuneWS(t[i-1].s)) && (i == len(t)-1 || firstRuneIn(t[i+1].s, ";&|)")) {
				b.WriteString("_")
			}
		case proof:
			if x.k == "h" {
				b.WriteString(textB(c))
			} else {
				b.WriteString("_")
			}
		case x.k == "h":
			b.WriteString(dqc(c))
		default:
			b.WriteString(qsepRe().ReplaceAllString(c, "_"))
		}
	}
	return b.String()
}

// qmodel is the program's `qmodel`: every quoted span complete, no comment, a `bash -c` string itself modeled, no
// substitution in double quotes the model cannot read.
func qmodel(s string) bool {
	if strings.Contains(s, "\r\n") {
		return false
	}
	h, ok := hdocs(s)
	if !ok {
		return false
	}
	t := qtokens(h)
	for i, x := range t {
		switch x.k {
		case "p":
			if cmtRe().MatchString(x.s) {
				return false
			}
			if shchRe().MatchString(x.s) {
				if !(shcdRe().MatchString(x.s) && i+1 < len(t) && (t[i+1].k == "s" || t[i+1].k == "h") &&
					(i+2 == len(t) || (t[i+2].k == "p" && nextOK().MatchString(t[i+2].s))) &&
					qmodel(dropFirstRune(dropLastRune(t[i+1].s)))) {
					return false
				}
			}
		case "s":
			if !sqClose().MatchString(x.s) {
				return false
			}
		case "a":
			if !aqClose().MatchString(x.s) {
				return false
			}
		case "h":
			if !dqClose().MatchString(x.s) || dqSubRe().MatchString(gsubHdop(x.s)) {
				return false
			}
		}
	}
	return true
}

// gsubHdop is `gsub(HDOP; "<<_")`.
func gsubHdop(s string) string {
	var b strings.Builder
	prev := 0
	for _, h := range hdops(s) {
		b.WriteString(s[prev:h.off])
		b.WriteString("<<_")
		prev = h.off + h.n
	}
	b.WriteString(s[prev:])
	return b.String()
}
