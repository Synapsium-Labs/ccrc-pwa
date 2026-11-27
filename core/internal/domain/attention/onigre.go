package attention

import (
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"
)

// The pieces every Oniguruma port in this package shares (wave 2 Task 5): the classes jq's Oniguruma reads that Go's
// regexp spells otherwise, and the jq builtins over regexes. jq compiles every pattern with Oniguruma's Perl_NT syntax,
// whose ONIG_OPTION_SINGLELINE makes `^` the start of the text (`\A`) and `$` the end of the text or a final newline
// before it (`\Z`, which Go lacks: `(?:\n?\z)` at a pattern's end), and `.` refuses a newline as Go's does. Measured
// on jq 1.7 and 1.8 (testdata/gen-onig-classes.sh): `\s` and `[[:space:]]` are the same set, U+000B and U+0085 in it,
// where Go's `\s` holds neither, so no pattern here writes Go's `\s`, `\S` or `[[:space:]]`.

// onigS is the body of a class holding Oniguruma's `\s` (= `[[:space:]]`, onigSpace), for splicing into an RE2 class.
const onigS = `\t-\r \x{85}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}`

// onigSNoNL is onigS less the newline: Oniguruma's `[^\S\n]`.
const onigSNoNL = `\t\x0b-\r \x{85}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}`

// re compiles a pattern once, when first asked: the hook is a process per event, and most events never reach a deny.
func re(p string) func() *regexp.Regexp {
	return sync.OnceValue(func() *regexp.Regexp { return regexp.MustCompile(p) })
}

// isOnigS is `\s` for one rune.
func isOnigS(r rune) bool { return onigSpace(r) }

// runeLen is the width of the character at s[i:] (1 for a byte that starts no valid sequence: the strings here are
// jq's, so always UTF-8).
func runeLen(s string, i int) int {
	_, n := utf8.DecodeRuneInString(s[i:])
	if n == 0 {
		return 1
	}
	return n
}

// prevRune is the character before s[i] (utf8.RuneError, 0 at the start).
func prevRune(s string, i int) (rune, bool) {
	if i == 0 {
		return 0, false
	}
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return r, true
}

// jqSplitRe is `split($re; null)` for a pattern that never matches empty: the pieces between its leftmost-first matches.
func jqSplitRe(s string, r *regexp.Regexp) []string { return r.Split(s, -1) }

// dropLastRune is `.[0:-1]` over code points.
func dropLastRune(s string) string {
	if s == "" {
		return s
	}
	_, n := utf8.DecodeLastRuneInString(s)
	return s[:len(s)-n]
}

// dropFirstRune is `.[1:]` over code points.
func dropFirstRune(s string) string {
	if s == "" {
		return s
	}
	return s[runeLen(s, 0):]
}

// trimTabs is `sub("^\\t+"; "")`.
func trimTabs(s string) string { return strings.TrimLeft(s, "\t") }

// cmdSubst is what `x=$(jq -r …)` keeps of a raw output line: every NUL byte dropped, then every trailing newline cut.
func cmdSubst(out string) string {
	return strings.TrimRight(strings.ReplaceAll(out, "\x00", ""), "\n")
}
