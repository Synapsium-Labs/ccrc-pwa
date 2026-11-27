package host

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

// TestLocaleInstalledMeasured asks LocaleInstalled about every name the locale golden measured, on a box whose
// `locale -a` is the golden's (the Linux bench): its answer is the installed list's, read as glibc reads a name.
func TestLocaleInstalledMeasured(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("glibc's lookup")
	}
	b, err := os.ReadFile("../../domain/attention/testdata/locale.golden")
	if err != nil {
		t.Fatal(err)
	}
	var head string
	for _, l := range strings.Split(string(b), "\n") {
		if h, ok := strings.CutPrefix(l, "# installed "); ok {
			head = h
		}
	}
	out, err := exec.Command("sh", "-c", "locale -a | LC_ALL=C sort | tr '\\n' ' ' | sed 's/ $//'").Output()
	if err != nil || string(out) != head {
		t.Skipf("this box's locales (%q) are not the golden's (%q)", out, head)
	}
	for name, want := range map[string]bool{"C.UTF-8": true, "C.utf8": true, "en_US.UTF-8": false, "xx_YY.UTF-8": false,
		"en_US": false, "C.utf8/../x": false} {
		if got := LocaleInstalled(name); got != want {
			t.Errorf("LocaleInstalled(%q) = %v, want %v", name, got, want)
		}
	}
	t.Setenv("LOCPATH", t.TempDir())
	if LocaleInstalled("en_US.UTF-8") {
		t.Error("an empty LOCPATH holds no locale")
	}
}

// TestLocaleInstalledBuilt asks LocaleInstalled about locales localedef builds where no root is needed: a LOCPATH
// directory (the directory arm), and an archive under a prefix (the archive arm, localeDir pointed at it). It skips
// where localedef or its i18n sources are missing.
func TestLocaleInstalledBuilt(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("glibc's lookup")
	}
	if _, err := exec.LookPath("localedef"); err != nil {
		t.Skip("no localedef")
	}
	lp := t.TempDir()
	_ = exec.Command("localedef", "-i", "en_US", "-f", "UTF-8", lp+"/en_US.UTF-8").Run()
	if _, err := os.Stat(lp + "/en_US.UTF-8/LC_CTYPE"); err != nil {
		t.Skip("localedef cannot build en_US.UTF-8 here (no i18n sources)")
	}
	t.Run("LOCPATH", func(t *testing.T) {
		t.Setenv("LOCPATH", lp)
		for name, want := range map[string]bool{"en_US.UTF-8": true, "en_US": false, "xx_YY.UTF-8": false} {
			if got := LocaleInstalled(name); got != want {
				t.Errorf("LOCPATH: LocaleInstalled(%q) = %v, want %v", name, got, want)
			}
		}
	})
	t.Run("archive", func(t *testing.T) {
		pfx := t.TempDir()
		if err := os.MkdirAll(pfx+"/usr/lib/locale", 0o755); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("localedef", "--prefix", pfx, "-i", "en_US", "-f", "UTF-8", "en_US.UTF-8").CombinedOutput(); err != nil {
			if _, serr := os.Stat(pfx + "/usr/lib/locale/locale-archive"); serr != nil {
				t.Skipf("localedef cannot add to an archive under a prefix: %v %s", err, out)
			}
		}
		t.Setenv("LOCPATH", "")
		old := localeDir
		localeDir = pfx + "/usr/lib/locale"
		defer func() { localeDir = old }()
		for name, want := range map[string]bool{"en_US.UTF-8": true, "en_US.utf8": true, "en_US": false, "en_GB.UTF-8": false} {
			if got := LocaleInstalled(name); got != want {
				t.Errorf("archive: LocaleInstalled(%q) = %v, want %v", name, got, want)
			}
		}
	})
}
