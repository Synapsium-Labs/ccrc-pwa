package attention

import "regexp"

// The locale's unit: bash counts `${#x}` and cuts `${x:0:n}` in characters under a UTF-8 LC_CTYPE and in bytes
// otherwise, and the LC_CTYPE it holds is the one it took at startup (it never re-reads the environment). This is the one
// owner of that rule; every length and cut the hook spells in the bash's unit goes through Chars and Clip.

// localeCategories are glibc's categories (setlocale(LC_ALL, "") resolves each from LC_ALL, its own variable, then LANG).
var localeCategories = []string{"LC_CTYPE", "LC_COLLATE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME",
	"LC_PAPER", "LC_NAME", "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT", "LC_IDENTIFICATION"}

var utf8Codeset = regexp.MustCompile(`(?i)\.utf-?8(@|\z)`)

// UTF8Units says whether bash's LC_CTYPE is UTF-8, as measured (testdata/locale.golden, every combination of LC_ALL,
// LC_CTYPE, LANG and LC_MESSAGES over set, empty, C, POSIX, installed and missing names): an empty variable is unset; a
// non-empty LC_ALL decides alone (a missing one is C); else glibc's startup setlocale sets every category at once, and
// when any category's name is missing it fails whole, and bash then sets LC_ALL from LANG (nothing when LANG is empty or
// missing) and LC_CTYPE over it when that one is installed. installed answers whether a name other than C and POSIX is
// a locale this box has. A name is UTF-8 by its codeset (shortcut: an installed name with no codeset, which takes the
// locale's own, is read as not UTF-8; on Debian and Ubuntu such names are the ISO-8859 ones: D-TBD-go-hook-locale-codeset).
func UTF8Units(getenv func(string) string, installed func(string) bool) bool {
	ok := func(n string) bool { return n == "C" || n == "POSIX" || installed(n) }
	if a := getenv("LC_ALL"); a != "" {
		return ok(a) && utf8Codeset.MatchString(a)
	}
	lang, ctype := getenv("LANG"), getenv("LC_CTYPE")
	whole := true
	for _, c := range localeCategories {
		n := getenv(c)
		if n == "" {
			n = lang
		}
		if n != "" && !ok(n) {
			whole = false
		}
	}
	if whole {
		if ctype == "" {
			ctype = lang
		}
		return utf8Codeset.MatchString(ctype)
	}
	if lang == "" || !ok(lang) {
		return false
	}
	if ctype != "" && ok(ctype) {
		return utf8Codeset.MatchString(ctype)
	}
	return utf8Codeset.MatchString(lang)
}

// Chars is `${#x}`: characters under a UTF-8 locale, as glibc's decoder reads them (charLen), bytes otherwise.
func Chars(s string, utf bool) int {
	if !utf {
		return len(s)
	}
	n := 0
	for i := 0; i < len(s); i += charLen(s[i:]) {
		n++
	}
	return n
}

// Clip is `${x:0:n}` in the same unit. D-TBD-go-hook-char-units: `${#out}` and `${x:0:n}` count code points when
// LC_ALL, LC_CTYPE or LANG names a UTF-8 locale, else bytes; a named locale is taken as installed.
func Clip(s string, n int, utf bool) string {
	if !utf {
		if len(s) > n {
			return s[:n]
		}
		return s
	}
	i := 0
	for k := 0; k < n && i < len(s); k++ {
		i += charLen(s[i:])
	}
	return s[:i]
}

// charLen is the width of the character at the head of s as glibc's UTF-8 decoder reads it, which bash counts with (a
// sequence it refuses, or one cut short, is one byte, as bash advances over it), measured in testdata/utf8.golden: the
// forms up to six bytes (so above U+10FFFF too, where Go's decoder stops), each refused when overlong, and the UTF-16
// surrogates refused.
func charLen(s string) int {
	b := s[0]
	var n int
	var min, cp rune
	switch {
	case b < 0x80:
		return 1
	case b >= 0xc2 && b <= 0xdf:
		n, min, cp = 2, 0x80, rune(b&0x1f)
	case b >= 0xe0 && b <= 0xef:
		n, min, cp = 3, 0x800, rune(b&0x0f)
	case b >= 0xf0 && b <= 0xf7:
		n, min, cp = 4, 0x10000, rune(b&0x07)
	case b >= 0xf8 && b <= 0xfb:
		n, min, cp = 5, 0x200000, rune(b&0x03)
	case b >= 0xfc && b <= 0xfd:
		n, min, cp = 6, 0x4000000, rune(b&0x01)
	default:
		return 1
	}
	if len(s) < n {
		return 1
	}
	for i := 1; i < n; i++ {
		if s[i]&0xc0 != 0x80 {
			return 1
		}
		cp = cp<<6 | rune(s[i]&0x3f)
	}
	if cp < min || cp >= 0xd800 && cp <= 0xdfff {
		return 1
	}
	return n
}
