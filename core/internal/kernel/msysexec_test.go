package kernel

import "testing"

// The table is MSYS2 bash's `-x` on each file, measured on a Windows box (Task 9b): kernel.MsysExecutable must answer it.
func TestMsysExecutableMeasured(t *testing.T) {
	for _, c := range []struct {
		name, head string
		want       bool
	}{
		{"shebang", "#!/", true}, {"mz", "MZ", true}, {"colon", ":\ne", true}, {"t.exe", "", true}, {"F.EXE", "x", true},
		{"h.lnk", "x", true}, {"noext_pe", "MZ\x90", true}, {"bang2", "#!", true},
		{"plain", "ech", false}, {"a.cmd", "@ec", false}, {"b.bat", "@ec", false}, {"f.com", "x", false}, {"empty", "", false},
		{"spbang", " #!", false}, {"m1", "M", false}, {"colonr", ":\r\n", false},
	} {
		if got := MsysExecutable(c.name, []byte(c.head)); got != c.want {
			t.Errorf("MsysExecutable(%q, %q) = %v, want %v", c.name, c.head, got, c.want)
		}
	}
}

func TestMsysQuoteArg(t *testing.T) {
	for in, want := range map[string]string{
		``: `""`, `a`: `"a"`, `a b`: `"a b"`, `*`: `"*"`, `a"b`: `"a\"b"`, `a\b`: `"a\b"`, `a\`: `"a\\"`, `a\"b`: `"a\\\"b"`,
		`C:\x\y\`: `"C:\x\y\\"`,
	} {
		if got := MsysQuoteArg(in); got != want {
			t.Errorf("MsysQuoteArg(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestCygwinQuoteArg(t *testing.T) {
	for in, want := range map[string]string{
		``: `""`, `a`: `"a"`, `*`: `"*"`, `a"b`: `"a\"b"`, `a\b`: `"a\\b"`, `a\\b`: `"a\\\\b"`, `a\`: `"a\\"`,
		`a\"b`: `"a\\\"b"`, `C:\x\y\`: `"C:\\x\\y\\"`,
	} {
		if got := CygwinQuoteArg(in); got != want {
			t.Errorf("CygwinQuoteArg(%q) = %s, want %s", in, got, want)
		}
	}
}
