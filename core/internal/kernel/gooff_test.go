package kernel

import (
	"strings"
	"testing"
)

// The same cases server/test/ccd-core-entry.test.ts holds the launcher's `core_off` to, for the verb `hook`.
func TestGoOffNames(t *testing.T) {
	bom := []byte{0xef, 0xbb, 0xbf}
	utf16 := []byte{0xff, 0xfe, 'c', 0, 'a', 0, 'p', 0, 's', 0, '\r', 0, '\n', 0}
	for _, c := range []struct {
		name string
		in   []byte
		off  bool
	}{
		{"empty sends every verb", nil, true},
		{"only blanks", []byte(" \n\t\r\n"), true},
		{"names hook", []byte("list\nhook\n"), true},
		{"names other verbs only", []byte("list\ncaps\n"), false},
		{"crlf lines", []byte("caps\r\nhook\r\n"), true},
		{"BOM and a name", append(append([]byte{}, bom...), "hook\r\n"...), true},
		{"BOM and other names", append(append([]byte{}, bom...), "caps\r\n"...), false},
		{"UTF-16 reads as no verb word: off", utf16, true},
		{"a line that is no verb word", []byte("list\nHook please\n"), true},
		{"a verb word too long", []byte(strings.Repeat("a", 42) + "\n"), true},
		{"form feed splits lines", []byte("caps\fhook"), true},
		{"unicode separator splits lines", []byte("caps hook"), true},
	} {
		if got := GoOffNames(c.in, "hook"); got != c.off {
			t.Errorf("%s: GoOffNames = %v, want %v", c.name, got, c.off)
		}
	}
}
