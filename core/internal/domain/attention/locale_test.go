package attention

import (
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"testing"
)

// TestLocaleMeasured holds UTF8Units, Chars and Clip to bash's own answers (testdata/gen-locale.sh, run on the Linux
// bench): every row's environment decides the unit, and each probe's length and two cuts come out as bash's did. The
// installed set is the golden's own header (the box's `locale -a`, or the LOCPATH the locpath run built: en_US.UTF-8 and
// the codeset-less en_US), read as glibc reads a name (its codeset lowercased, its punctuation dropped), which is what
// host.LocaleInstalled answers there.
func TestLocaleMeasured(t *testing.T) {
	for _, f := range []string{"testdata/locale.golden", "testdata/locale-locpath.golden"} {
		t.Run(f, func(t *testing.T) { localeMeasured(t, f) })
	}
}

// localeMeasured is one golden's replay: the bench's own locales, or a LOCPATH that localedef filled.
func localeMeasured(t *testing.T, f string) {
	b, err := os.ReadFile(f)
	if err != nil {
		t.Fatal(err)
	}
	probes := []string{"\xc3\xa9\xe2\x80\xa6a", "\xff\xc3a", "a\xe2\x80"}
	inst := map[string]bool{}
	rows := 0
	for _, line := range strings.Split(strings.TrimRight(string(b), "\n"), "\n") {
		if l, ok := strings.CutPrefix(line, "# installed "); ok {
			for _, n := range strings.Fields(l) {
				inst[n] = true
			}
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Fields(line)
		env := map[string]string{}
		for i, k := range []string{"LC_ALL", "LC_CTYPE", "LANG", "LC_MESSAGES"} {
			switch f[i] {
			case "-":
			case "''":
				env[k] = ""
			default:
				env[k] = f[i]
			}
		}
		installed := func(n string) bool {
			if inst[n] {
				return true
			}
			lang, cs, ok := strings.Cut(n, ".")
			if !ok {
				return false
			}
			var norm strings.Builder
			for _, r := range strings.ToLower(cs) {
				if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
					norm.WriteRune(r)
				}
			}
			return inst[lang+"."+norm.String()]
		}
		utf := UTF8Units(func(k string) string { return env[k] }, installed)
		for i, p := range probes {
			n, _ := strconv.Atoi(f[4+3*i])
			got := []string{strconv.Itoa(Chars(p, utf)), hex.EncodeToString([]byte(Clip(p, 1, utf))), hex.EncodeToString([]byte(Clip(p, 2, utf)))}
			want := []string{strconv.Itoa(n), f[5+3*i], f[6+3*i]}
			if strings.Join(got, " ") != strings.Join(want, " ") {
				t.Errorf("%s probe %d: got %v, bash %v (utf %v)", strings.Join(f[:4], " "), i, got, want, utf)
			}
		}
		rows++
	}
	if rows < 2000 {
		t.Fatalf("only %d rows measured", rows)
	}
}

// TestUTF8Measured holds Chars and Clip under a UTF-8 locale to bash's own answers over the decoder sweep
// (testdata/gen-utf8.sh): every lead byte with each count of continuation bytes at the range edges.
func TestUTF8Measured(t *testing.T) {
	b, err := os.ReadFile("testdata/utf8.golden")
	if err != nil {
		t.Fatal(err)
	}
	rows := 0
	for _, line := range strings.Split(strings.TrimRight(string(b), "\n"), "\n") {
		if strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Fields(line)
		in, _ := hex.DecodeString(f[0])
		p := string(in)
		got := []string{strconv.Itoa(Chars(p, true)), hex.EncodeToString([]byte(Clip(p, 1, true))), hex.EncodeToString([]byte(Clip(p, 2, true)))}
		if strings.Join(got, " ") != strings.Join(f[1:], " ") {
			t.Errorf("%s: got %v, bash %v", f[0], got, f[1:])
		}
		rows++
	}
	if rows < 3000 {
		t.Fatalf("only %d rows", rows)
	}
}
