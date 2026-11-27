//go:build !windows

package host

// cygwinLocale is asked on Windows only (locale_windows.go).
func cygwinLocale(string) bool { return true }
