//go:build windows

package host

import (
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

var (
	localeNameToLCID = syscall.NewLazyDLL("kernel32.dll").NewProc("LocaleNameToLCID")
	cygwinLocaleBase = regexp.MustCompile(`^[a-z]{2,3}(_[A-Z]{2})?$`)
)

// cygwinLocale is whether MSYS2's (Cygwin's) setlocale loads name, the bash hook's runtime on Windows: C and POSIX
// (exactly so cased) always; else the name before its codeset and modifier must be a lowercase language with an
// optional uppercase territory, which Windows knows (LocaleNameToLCID over `lang-TERR`, neither 0 nor the
// LOCALE_CUSTOM_UNSPECIFIED it answers an unknown well-formed name with). Measured against MSYS2's
// bash, locale_windows_test.go#TestLocaleInstalledAsMsysBash: EN_us, en-US, c.UTF-8, en_ZZ and no_NO refused, en,
// en_GB, sr_RS@latin and de_DE@euro loaded. The codeset itself is the caller's (utf8Locale). shortcut: a language
// Windows names with a script only (sr_RS, no modifier) Cygwin loads through its own default script and this reads as
// missing (D-TBD-go-hook-locale-lookup); no fleet box sets one. Upgrade with Cygwin's script table if one ever does.
func cygwinLocale(name string) bool {
	base, mod, _ := strings.Cut(name, "@")
	base, _, _ = strings.Cut(base, ".")
	if base == "C" || base == "POSIX" {
		return true
	}
	if !cygwinLocaleBase.MatchString(base) {
		return false
	}
	tag := strings.ReplaceAll(base, "_", "-")
	if script := map[string]string{"latin": "Latn", "cyrillic": "Cyrl"}[mod]; script != "" && strings.Contains(tag, "-") {
		tag = strings.Replace(tag, "-", "-"+script+"-", 1) // sr_RS@latin is sr-Latn-RS, as Cygwin reads the modifier
	}
	u, err := syscall.UTF16PtrFromString(tag)
	if err != nil {
		return false
	}
	lcid, _, _ := localeNameToLCID.Call(uintptr(unsafe.Pointer(u)), 0)
	return lcid != 0 && lcid != 0x1000 // LOCALE_CUSTOM_UNSPECIFIED: Windows' answer for a well-formed name it does not know
}
