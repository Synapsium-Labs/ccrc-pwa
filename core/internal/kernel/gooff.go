package kernel

import (
	"bytes"
	"regexp"
	"strings"
)

var verbWord = regexp.MustCompile(`^[a-z][a-z0-9-]{0,40}$`)

// goOffStrip is the launcher's CORE_OFF_STRIP: blanks, NUL and the replacement character.
const goOffStrip = " \t\r\n\v\f\x00�"

// GoOffNames reads the contents of `~/.cc-sessions/ccd-go-off` as the launcher's `core_off` does (ccd/ccd-entry.py, the
// other reader: a Python process, so a second parser by necessity, held to this one by TestGoOffNames, which carries the
// launcher's own cases) and answers whether verb is sent back to bash. An empty file, or a line that is no verb word
// after the blanks are trimmed (a UTF-16 file reads as letters between NULs), turns every verb off: the safe answer is
// bash. A UTF-8 BOM is dropped; invalid bytes read as U+FFFD, which the trim removes at the ends.
func GoOffNames(content []byte, verb string) bool {
	content = bytes.TrimPrefix(content, []byte{0xef, 0xbb, 0xbf})
	text := strings.ToValidUTF8(string(content), "�")
	// Python's str.splitlines breaks on more than \n: \r, \v, \f, the information separators, NEL and the Unicode separators.
	lines := strings.FieldsFunc(text, func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\v' || r == '\f' || (r >= 0x1c && r <= 0x1e) || r == 0x85 || r == 0x2028 || r == 0x2029
	})
	named := false
	n := 0
	for _, l := range lines {
		l = strings.Trim(l, goOffStrip)
		if l == "" {
			continue
		}
		n++
		if !verbWord.MatchString(l) {
			return true
		}
		if l == verb {
			named = true
		}
	}
	return n == 0 || named
}
