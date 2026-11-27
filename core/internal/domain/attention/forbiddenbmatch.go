package attention

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// bmatch is the program's `bmatch`, its rows in order: a write to a Claude Code build or its launcher (BW), a write to a
// file the launcher, the roll or this guard trusts (BTR), and installing or updating a build (BI).
func (g *guard) bmatch(s string) string {
	b := g.b
	bx, tr := b.buildx().MatchString, b.trust().MatchString
	if bx(s) {
		switch {
		case hbt(segSplit(s), bwr, b.buildTail), findw(s, bx), xargsw(s, bx), interpRe().MatchString(s):
			return bwWhy
		}
	}
	if cdthen(s, b.cd5().MatchString, bwr, bwr) ||
		cdthen(s, b.cd6().MatchString, b.gate6().MatchString, func(x string) bool { return hb1(x, bwr, b.clopTail) }) ||
		cdthen(s, b.cd7().MatchString, b.gateLocal().MatchString, func(x string) bool { return hb1(x, bwr, b.localTail) }) ||
		cdthen(s, b.cdHome().MatchString, b.gateHome().MatchString, func(x string) bool { return hb1(x, bwr, b.homeTail) }) ||
		cdthen(s, b.cdBin().MatchString, b.binName().MatchString, func(x string) bool { return hb1(x, bwr, b.binTail) }) ||
		varw(s, bx) || pdirw(s, b.pdirLocal().MatchString, b.compClaude().MatchString) {
		return bwWhy
	}
	if tr(s) && (hbt(segSplit(s), bwr, b.trustTail) || findw(s, tr) || xargsw(s, tr) || interpRe().MatchString(s) || varw(s, tr)) ||
		pdirw(s, b.pdirCcrc().MatchString, b.compTnc().MatchString) || pdirw(s, b.pdirSess().MatchString, b.compTns().MatchString) ||
		cdthen(s, b.cdCcrcR().MatchString, b.gateCcrc().MatchString, func(x string) bool { return hb1(x, bwr, b.tncTail) }) ||
		cdthen(s, b.cdSessR().MatchString, b.gateSess().MatchString, func(x string) bool { return hb1(x, bwr, b.tnsTail) }) {
		return btrWhy
	}
	if b.cli().MatchString(s) || (b.claudeWord().MatchString(s) && b.expVerb().MatchString(s)) ||
		cdthen(s, b.cdVersd().MatchString, b.verw().MatchString, b.verw().MatchString) || installerURL(s) || npmGlobal(s) {
		return biWhy
	}
	return ""
}

var varDef = re(`(?:\A|[` + wsc + `;&|(])([A-Za-z_][A-Za-z0-9_]{0,63})=([^` + wsc + `;&|()]{0,1000}[^` + wsc + `;&|()]{0,24})`)

// varw is `varw($re)`: the names (at most 17 looked at) a value naming the path is assigned to, and a write through
// `$name` or `${name}` after it; more than 16 refuse outright. `{0,1024}`, past RE2's 1000, is spelled `{0,1000}{0,24}`.
func varw(s string, r func(string) bool) bool {
	if !r(s) || !strings.Contains(s, "=") {
		return false
	}
	var names []string
	for _, m := range varDef().FindAllStringSubmatchIndex(s, -1) {
		if r(s[m[4]:m[5]]) {
			names = append(names, s[m[2]:m[3]])
			if len(names) == 17 {
				break
			}
		}
	}
	if len(names) > 16 {
		return true
	}
	if len(names) == 0 {
		return false
	}
	tail := newLastStartNow(`\$\{?(?:` + strings.Join(uniqueSorted(names), "|") + `)` + naEnd)
	return hbt(segSplit(s), bwr, tail)
}

// newLastStartNow is a lastStart compiled at once, for a tail made of the command's own names.
func newLastStartNow(body string) lastStart {
	r := regexp.MustCompile(`(?s)\A(.*)(?:` + body + `)`)
	return lastStart{res: []func() *regexp.Regexp{func() *regexp.Regexp { return r }}}
}

// pdirw is `pdirw($d; $n)`.
func pdirw(s string, pdir, comp func(string) bool) bool {
	if !pdir(s) || !comp(s) {
		return false
	}
	for _, seg := range segSplit(s) {
		if bwr(seg) && pdir(seg) && comp(seg) {
			return true
		}
	}
	return false
}

// ── the two `test(…; "i")` rows ──

// ifold is Oniguruma's case folding onto the letters the two case-insensitive patterns hold, as testdata/ifold.txt
// measured it: ASCII letters either way, U+017F as `s`, and the ligatures U+FB01 (`fi`), U+FB05 and U+FB06 (`st`).
// Every other character folds to itself.
func ifold(r rune) (string, bool) {
	switch {
	case r >= 'A' && r <= 'Z':
		return string(r + 32), true
	case r == 0x17f:
		return "s", true
	case r == 0xfb01:
		return "fi", true
	case r == 0xfb05 || r == 0xfb06:
		return "st", true
	}
	return "", false
}

// folded is s with each rune folded, and the byte offset in s each byte of the folded text came from.
func folded(s string) (string, []int) {
	var b strings.Builder
	var at []int
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		if f, ok := ifold(r); ok {
			b.WriteString(f)
			for range f {
				at = append(at, i)
			}
		} else {
			b.WriteString(s[i : i+n])
			for k := 0; k < n; k++ {
				at = append(at, i)
			}
		}
		i += n
	}
	return b.String(), at
}

// installerURL is `test("claude\\.ai/install\\.(?:sh|ps1|cmd)|downloads\\.claude\\.ai"; "i")`. No needle starts or ends
// inside a ligature's letters (it starts `c` or `d`, ends `h`, `1`, `d` or `i`), so a search of the folded text finds
// exactly the matches Oniguruma's does.
func installerURL(s string) bool {
	if !strings.ContainsAny(s, "lLdD") {
		return false
	}
	f, _ := folded(s)
	for _, n := range []string{"claude.ai/install.sh", "claude.ai/install.ps1", "claude.ai/install.cmd", "downloads.claude.ai"} {
		if strings.Contains(f, n) {
			return true
		}
	}
	return false
}

// npmConfig is `test("(?:^|SP)npm_config_(?:global|location)="; "i")`: the folded needle, at the start or after a blank
// of the original text.
func npmConfig(s string) bool {
	f, at := folded(s)
	for _, n := range []string{"npm_config_global=", "npm_config_location="} {
		for off := 0; ; {
			k := strings.Index(f[off:], n)
			if k < 0 {
				break
			}
			o := at[off+k]
			if r, ok := prevRune(s, o); !ok || isWS(r) {
				return true
			}
			off += k + 1
		}
	}
	return false
}

var (
	npmHead  = re(wb + `(?:npm|pnpm|yarn|bun)` + nwEnd)
	npmVerb  = re(sp + `(?:install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add|update|udpate|up|upgrade)` + nwEnd)
	npmGlobF = re(`(?:\A|` + sp + `)(?:(?:-g|--global|--location=global|global)` + nwEnd + `|--prefix(?:=|` + sp + `+)` + ns + `{0,256}\.local` + nwEnd + `)`)
)

// npmGlobal is the global package install of `@anthropic-ai/claude-code` by npm, pnpm, yarn or bun.
func npmGlobal(s string) bool {
	if !strings.Contains(s, "@anthropic-ai/claude-code") {
		return false
	}
	for _, seg := range splitAny(s, "\n;&|") {
		if npmHead().MatchString(seg) && npmVerb().MatchString(seg) && strings.Contains(seg, "@anthropic-ai/claude-code") &&
			(npmGlobF().MatchString(seg) || npmConfig(seg)) {
			return true
		}
	}
	return false
}
