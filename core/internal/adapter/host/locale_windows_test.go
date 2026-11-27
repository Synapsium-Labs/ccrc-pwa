//go:build windows

package host

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// LocaleInstalled on Windows answers what MSYS2's bash's setlocale answers (it warns "cannot change locale" for a name
// it cannot load), measured name by name against the box's MSYS2 bash.
func TestLocaleInstalledAsMsysBash(t *testing.T) {
	bash := `C:\msys64\usr\bin\bash.exe`
	if _, err := os.Stat(bash); err != nil {
		t.Skip("no MSYS2 bash")
	}
	t.Setenv("PATH", filepath.Dir(bash)+string(os.PathListSeparator)+os.Getenv("PATH"))
	for _, n := range []string{"C.UTF-8", "C.utf8", "c.UTF-8", "POSIX", "en_US.UTF-8", "en_US.utf8", "en_US.UTF8", "en_US",
		"en.UTF-8", "en_GB.UTF-8", "EN_us.UTF-8", "en-US.UTF-8", "ja_JP.UTF-8", "sr_RS.UTF-8@latin", "sr_RS.UTF-8@cyrillic", "sr_RS.UTF-8", "de_DE@euro", "de_DE.UTF-8@euro",
		"zh_CN.UTF-8", "uk_UA.UTF-8", "nb_NO.UTF-8", "no_NO.UTF-8", "zz_ZZ.UTF-8", "xx.UTF-8", "en_ZZ.UTF-8"} {
		cmd := exec.Command(bash, "-c", ":")
		cmd.Env = append(os.Environ(), "LC_ALL="+n)
		out, _ := cmd.CombinedOutput()
		loads := !strings.Contains(string(out), "cannot change locale")
		// D-TBD-go-hook-locale-lookup on Windows: a language whose territory Windows names only with a script (sr_RS)
		// Cygwin loads through its own script default; this reads it missing (bytes, where the bash counts code points).
		known := n == "sr_RS.UTF-8"
		if got := LocaleInstalled(n); (got != loads) != known {
			t.Errorf("LocaleInstalled(%q) = %v, MSYS2's bash loads it: %v (a recorded difference: %v)", n, got, loads, known)
		}
	}
}
