package attention

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// pmglob is the program's `pmglob`: each glob segment directly under `~/.ccrc` (DANC, `.ccrc`, SEPP, a run holding a
// glob character, then the end of the word), turned into a regex by `g2re` and tested whole against the private store's
// five names; a pattern Oniguruma refuses counts as a match (`try … catch true`). The pattern is built from the
// command's text, and RE2's bracket syntax is not Oniguruma's, so it is never handed to RE2: onigGlob reads g2re's
// output grammar as Oniguruma does.
func pmglob(seg string) bool {
	for _, g := range pmglobWords(seg) {
		if onigRetryRisk(g) { // jq's search would run out of retries: an error, which `catch true` reads as a match
			return true
		}
		r := g2re(g)
		for _, name := range pmNames {
			if m, err := onigGlob(r, name); err || m {
				return true
			}
		}
	}
	return false
}

// onigRetryRisk says a glob word's pattern may run Oniguruma out of retries against the five names (task 5 review F9,
// rounds 1 to 3). The search backtracks through every way the word's `*`s (each `[^/]*`) can share a name's characters,
// once per branch of its alternations: about C(L+k, k) times the branches' product, for k the word's TOTAL stars (a
// `?` or a letter between them does not end the backtracking) and L the longest name's 21 characters. The one word it
// never fires on is stars and characters no name holds, with no `?`, class or alternation: Oniguruma's search optimiser
// refuses that at once (`*`×40 then `Q` never errs). Measured on jq 1.7 and jq 1.8.1 alike over the 20,527 words of
// testdata/guard-retry.golden (5,306 errors): the least estimate of any word jq errors on is 8.6 million (`********{a,b}Q`),
// and the bound is 4 million, so the predicate fires on every error and on neighbours jq still answers, a deny where bash
// allows: D-TBD-go-hook-onig-retry-limit's stricter side, which TestPmglobRetryGolden counts. The least TOTAL stars among
// the errors, by what else the word holds: 6 with a (60-way) alternation and a store-name letter, 8 with an alternation
// and a `?`, 9 with a class, 9 with a `?`, 10 with a store-name letter alone.
func onigRetryRisk(g string) bool {
	k := strings.Count(g, "*")
	shaped := false // a `?`, a class, an alternation or a character some store name holds
	for i := 0; i < len(g); i++ {
		switch c := g[i]; {
		case c == '*':
		case c == '?', c == '[':
			shaped = true
		case c == '{':
			if e := strings.IndexAny(g[i+1:], "{}"); e >= 0 && g[i+1+e] == '}' && strings.Contains(g[i+1:i+1+e], ",") {
				shaped = true
			}
		case strings.ContainsRune(pmNameChars, rune(c)):
			shaped = true
		}
	}
	if !shaped {
		return false
	}
	est := 1.0
	for i := 1; i <= k; i++ { // C(21+k, k)
		est = est * float64(21+i) / float64(i)
	}
	for _, w := range braceWidths(g) {
		est *= float64(w)
	}
	return est >= onigRetryBound
}

// pmNameChars are the characters the five names hold.
const pmNameChars = "-.abcdeghijlmnoprstuvwy"

const onigRetryBound = 4e6

// braceWidths are the branch counts of the alternations g2re makes: each innermost `{…}` and its commas, one pass.
func braceWidths(g string) []int {
	var out []int
	for i := 0; i < len(g); {
		if g[i] == '{' {
			if k := strings.IndexAny(g[i+1:], "{}"); k >= 0 && g[i+1+k] == '}' {
				out = append(out, strings.Count(g[i+1:i+1+k], ",")+1)
				i += k + 2
				continue
			}
		}
		i++
	}
	return out
}

var pmNames = []string{"operator-model.db", "operator-model.db-wal", "operator-model.db-shm", "privacy-journal.log", "privacy-journal.torn"}

var (
	pmgSepp = re(`\A` + sepp + `\.ccrc` + sepp + `(` + globw + `[*?\[{]` + globw + `)` + endAny)
	pmgLb   = re(`\A\.ccrc` + sepp + `(` + globw + `[*?\[{]` + globw + `)` + endAny)
)

// pmglobWords is `[match(DANC + "\\.ccrc" + SEPP + "(?<g>…)(?=$|[WS META])"; "g") | .captures[0].string]`: at each
// position SEPP's alternative first, then the lookbehind's; the next search starts where the match (its lookahead not
// included) ended.
func pmglobWords(s string) []string {
	var out []string
	for i := 0; i < len(s); {
		var m []int
		if s[i] == '/' {
			m = pmgSepp().FindStringSubmatchIndex(s[i:])
		}
		if m == nil && s[i] == '.' {
			if r, ok := prevRune(s, i); !ok || isWS(r) || strings.ContainsRune(`=:'"`, r) {
				m = pmgLb().FindStringSubmatchIndex(s[i:])
			}
		}
		if m == nil {
			i += runeLen(s, i)
			continue
		}
		out = append(out, s[i+m[2]:i+m[3]])
		i += m[3]
	}
	return out
}

// g2re is the program's `g2re`, its five gsubs in order.
func g2re(g string) string {
	var b strings.Builder
	for _, r := range g {
		if strings.ContainsRune(`.+^$()|\`, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	s := strings.ReplaceAll(b.String(), "[!", "[^")
	s = strings.ReplaceAll(s, "*", "[^/]*")
	s = strings.ReplaceAll(s, "?", "[^/]")
	// gsub("\\{(?<x>[^{}]*)\\}"; "(?:" + (.x | gsub(","; "|")) + ")"), one pass, leftmost first
	b.Reset()
	for i := 0; i < len(s); {
		if s[i] == '{' {
			if k := strings.IndexAny(s[i+1:], "{}"); k >= 0 && s[i+1+k] == '}' {
				b.WriteString("(?:" + strings.ReplaceAll(s[i+1:i+1+k], ",", "|") + ")")
				i += k + 2
				continue
			}
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// ── Oniguruma, for the grammar g2re writes ──
//
// The pattern is `^(?:R)$` over a name with no newline. R holds literals, `\` escapes, `(?:…|…)` groups, the `*`
// quantifier, and bracket classes with Oniguruma's own reading: a `]` first in a class is a member when another `]`
// closes it later, a `[` inside one opens a nested class (or a POSIX `[:name:]`), and a range runs from one member to
// the next. Anything it refuses here is a pattern Oniguruma refuses (testdata/gen-guard-golden.sh measures both).

type gnode struct {
	kind  byte // 'c' a character, 'k' a class, 'g' a group, '*' a star of sub[0]
	r     rune
	cls   func(rune) bool
	alts  [][]*gnode
	inner *gnode
}

type gparser struct {
	s   string
	i   int
	err bool
}

func onigGlob(r, name string) (match, err bool) {
	p := &gparser{s: r}
	alts := p.alts(false)
	if p.err || p.i != len(p.s) {
		return false, true
	}
	return gmatch(alts, name), false
}

func (p *gparser) alts(inGroup bool) [][]*gnode {
	var out [][]*gnode
	for {
		var seq []*gnode
		for p.i < len(p.s) && !p.err {
			c := p.s[p.i]
			if c == '|' || c == ')' {
				break
			}
			switch c {
			case '\\':
				if p.i+1 >= len(p.s) {
					p.err = true
					return out
				}
				r, n := utf8.DecodeRuneInString(p.s[p.i+1:])
				seq = append(seq, &gnode{kind: 'c', r: r})
				p.i += 1 + n
			case '[':
				p.i++
				f := p.class()
				seq = append(seq, &gnode{kind: 'k', cls: f})
			case '(':
				if !strings.HasPrefix(p.s[p.i:], "(?:") {
					p.err = true
					return out
				}
				p.i += 3
				a := p.alts(true)
				if p.err || p.i >= len(p.s) || p.s[p.i] != ')' {
					p.err = true
					return out
				}
				p.i++
				seq = append(seq, &gnode{kind: 'g', alts: a})
			case '*', '?', '+':
				if len(seq) == 0 {
					p.err = true
					return out
				}
				last := seq[len(seq)-1]
				if c != '*' {
					p.err = true // g2re never writes these unescaped outside a class
					return out
				}
				seq[len(seq)-1] = &gnode{kind: '*', inner: last}
				p.i++
			default:
				r, n := utf8.DecodeRuneInString(p.s[p.i:])
				seq = append(seq, &gnode{kind: 'c', r: r})
				p.i += n
			}
		}
		out = append(out, seq)
		if p.err || p.i >= len(p.s) || p.s[p.i] != '|' {
			break
		}
		p.i++
	}
	if !inGroup && p.i < len(p.s) && p.s[p.i] == ')' {
		p.err = true
	}
	return out
}

var posixClasses = map[string]func(rune) bool{
	"alpha": func(r rune) bool {
		return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r > 127 && onigAlnum(r) && !(r >= '0' && r <= '9')
	},
	"digit": func(r rune) bool { return r >= '0' && r <= '9' },
	"alnum": onigAlnum,
	"lower": func(r rune) bool { return r >= 'a' && r <= 'z' },
	"upper": func(r rune) bool { return r >= 'A' && r <= 'Z' },
	"punct": func(r rune) bool { return strings.ContainsRune("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", r) },
	"space": onigSpace,
	"blank": func(r rune) bool { return r == ' ' || r == '\t' },
	"cntrl": func(r rune) bool { return r < 32 || r == 127 },
	"print": func(r rune) bool { return r >= 32 && r != 127 },
	"graph": func(r rune) bool { return r > 32 && r != 127 },
	"xdigit": func(r rune) bool {
		return r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F'
	},
	"word":  func(r rune) bool { return r == '_' || onigAlnum(r) },
	"ascii": func(r rune) bool { return r < 128 },
}

// class reads a bracket class after its `[`, through its `]`, as Oniguruma's Perl_NT syntax does (measured,
// guard-globs.golden): a `[` inside is a member (no nested sets), except `[:name:]`, a POSIX class, or `[:…:]` with a name
// it does not know made of letters only, which it refuses; a `]` first is a member when an unescaped `]` follows; a
// range runs from one member to the next and is refused reversed or from or to a POSIX class.
func (p *gparser) class() func(rune) bool {
	neg := false
	if p.i < len(p.s) && p.s[p.i] == '^' {
		neg = true
		p.i++
	}
	var parts []func(rune) bool
	first := true
	for {
		if p.i >= len(p.s) {
			p.err = true
			return nil
		}
		if p.s[p.i] == ']' && !(first && closeLater(p.s, p.i+1)) {
			if first {
				p.err = true
				return nil
			}
			p.i++
			break
		}
		first = false
		if f, n, kind := posixAt(p.s, p.i); kind != 0 {
			if kind < 0 {
				p.err = true
				return nil
			}
			parts = append(parts, f)
			p.i += n
			// a range from a POSIX class: refused by jq 1.7's Oniguruma, read as a `-` member by jq 1.8.1's (bundled);
			// the refusal, which the program reads as a match (a deny), is kept (D-TBD-go-hook-onig-class-range)
			if p.i+1 < len(p.s) && p.s[p.i] == '-' && p.s[p.i+1] != ']' {
				p.err = true
				return nil
			}
			continue
		}
		lo, ok := p.classChar()
		if !ok {
			return nil
		}
		if p.i+1 < len(p.s) && p.s[p.i] == '-' && p.s[p.i+1] != ']' {
			p.i++
			if _, _, kind := posixAt(p.s, p.i); kind != 0 {
				p.err = true
				return nil
			}
			hi, ok := p.classChar()
			if !ok {
				return nil
			}
			if hi < lo {
				p.err = true
				return nil
			}
			parts = append(parts, func(r rune) bool { return r >= lo && r <= hi })
			continue
		}
		parts = append(parts, func(r rune) bool { return r == lo })
	}
	return func(r rune) bool {
		in := false
		for _, f := range parts {
			if f(r) {
				in = true
				break
			}
		}
		return in != neg
	}
}

// closeLater: an unescaped `]` from i on.
func closeLater(s string, i int) bool {
	for ; i < len(s); i++ {
		switch s[i] {
		case '\\':
			i++
		case ']':
			return true
		}
	}
	return false
}

// posixAt reads `[:name:]` (or `[:^name:]`) at i: kind 1 with its class and length, -1 for a name Oniguruma refuses (letters
// only, then `:]`; after `^` an empty one too: measured, it is not Oniguruma's documented rule), 0 when the `[` is a member.
func posixAt(s string, i int) (func(rune) bool, int, int) {
	if !strings.HasPrefix(s[i:], "[:") {
		return nil, 0, 0
	}
	j := i + 2
	neg := j < len(s) && s[j] == '^'
	if neg {
		j++
	}
	for name, f := range posixClasses {
		if strings.HasPrefix(s[j:], name+":]") {
			g := f
			if neg {
				g = func(r rune) bool { return !f(r) }
			}
			return g, j + len(name) + 2 - i, 1
		}
	}
	k := j
	for k < len(s) {
		r, w := utf8.DecodeRuneInString(s[k:])
		if !onigAlnum(r) || unicode.Is(unicode.Nd, r) {
			break
		}
		k += w
	}
	if strings.HasPrefix(s[k:], ":]") && (k > j || neg) {
		return nil, 0, -1
	}
	return nil, 0, 0
}

func (p *gparser) classChar() (rune, bool) {
	if p.s[p.i] == '\\' {
		if p.i+1 >= len(p.s) {
			p.err = true
			return 0, false
		}
		r, n := utf8.DecodeRuneInString(p.s[p.i+1:])
		p.i += 1 + n
		return r, true
	}
	r, n := utf8.DecodeRuneInString(p.s[p.i:])
	p.i += n
	return r, true
}

// gmatch is a whole-match test as a position-set walk (Thompson's): the set of offsets each node can end at, from the set
// it can start at, so its cost is the pattern's length times the name's, whatever the pattern's stars (review F3: a
// backtracking walk was exponential in them). The answer is the regex's, a language question with no captures.
func gmatch(alts [][]*gnode, s string) bool {
	rs := []rune(s)
	start := make([]bool, len(rs)+1)
	start[0] = true
	return gendsAlts(alts, rs, start)[len(rs)]
}

func gendsAlts(alts [][]*gnode, rs []rune, from []bool) []bool {
	out := make([]bool, len(from))
	for _, seq := range alts {
		for i, ok := range gendsSeq(seq, rs, from) {
			out[i] = out[i] || ok
		}
	}
	return out
}

func gendsSeq(seq []*gnode, rs []rune, from []bool) []bool {
	for _, n := range seq {
		from = gendsNode(n, rs, from)
	}
	return from
}

func gendsNode(n *gnode, rs []rune, from []bool) []bool {
	out := make([]bool, len(from))
	switch n.kind {
	case 'c', 'k':
		for i, ok := range from {
			if ok && i < len(rs) && ((n.kind == 'c' && rs[i] == n.r) || (n.kind == 'k' && n.cls(rs[i]))) {
				out[i+1] = true
			}
		}
	case 'g':
		return gendsAlts(n.alts, rs, from)
	case '*':
		copy(out, from)
		for frontier := from; ; {
			next := gendsNode(n.inner, rs, frontier)
			grew := false
			for i, ok := range next {
				if ok && !out[i] {
					out[i], grew = true, true
				} else {
					next[i] = false
				}
			}
			if !grew {
				break
			}
			frontier = next
		}
	}
	return out
}
