package attention

import (
	"strconv"
	"strings"
	"testing"
)

// Oniguruma's [[:alnum:]] and [[:space:]] as real jq measured them over every code point (testdata/gen-onig-classes.sh): jq's
// alnum set must be inside onigAlnum (Go's Unicode tables are newer, so a superset is the known, recorded difference; a Go
// toolchain that dropped a code point would be red here), and its space set must equal onigSpace exactly.
func TestOnigClasses(t *testing.T) {
	jqSpace := map[rune]bool{}
	alnum := 0
	for _, l := range readLinesFile(t, "onig-classes.txt") {
		class, rng, _ := strings.Cut(l, " ")
		lo, hi, _ := strings.Cut(rng, "-")
		a, _ := strconv.Atoi(lo)
		b, _ := strconv.Atoi(hi)
		for r := rune(a); r <= rune(b); r++ {
			switch class {
			case "alnum":
				alnum++
				if !onigAlnum(r) {
					t.Fatalf("U+%04X is alnum for jq and not for onigAlnum", r)
				}
			case "space":
				jqSpace[r] = true
			}
		}
	}
	if alnum < 100000 || len(jqSpace) < 20 {
		t.Fatalf("the measured file is too small: %d alnum, %d space", alnum, len(jqSpace))
	}
	for r := rune(0); r < 0x110000; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		if onigSpace(r) != jqSpace[r] {
			t.Errorf("U+%04X: onigSpace %v, jq %v", r, onigSpace(r), jqSpace[r])
		}
	}
}
