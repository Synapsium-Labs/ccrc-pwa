package attention

import "testing"

// pnorm folds a `~/` path under either HOME spelling: the bash's MSYS2 `/c/…` and the core's Windows `C:\…` (Task 9b
// gate round: a `~/.ccrc/./…` secret path went unfolded under a drive-letter HOME, so the account arm allowed a read the
// bash denies).
func TestPnormFoldsUnderAWindowsHome(t *testing.T) {
	secret := "~/.ccrc/./linear" + ".key"
	for _, c := range []struct{ p, home, want string }{
		{secret, "/c/Users/u", "/c/Users/u/.ccrc/linear.key"},
		{secret, `C:\Users\u`, `C:\Users\u/.ccrc/linear.key`},
		{"~/.ccrc/x/../linear.key", "C:/Users/u", "C:/Users/u/.ccrc/linear.key"},
		{"relative/./x", `C:\Users\u`, "relative/./x"},
		{"C:", `C:\Users\u`, "C:"},
	} {
		h := c.home
		if got := pnorm(c.p, &h); got != c.want {
			t.Errorf("pnorm(%q, %q) = %q, want %q", c.p, c.home, got, c.want)
		}
	}
	h := `C:\Users\u`
	if !apsec().MatchString(pnorm(secret, &h)) {
		t.Error("the account arm's secret pattern does not see the folded read under a Windows HOME")
	}
}
