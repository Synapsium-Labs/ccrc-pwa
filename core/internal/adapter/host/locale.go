package host

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// localeDir is glibc's locale directory, its archive inside (a variable, so a test can point it at one it built).
var localeDir = "/usr/lib/locale"

// LocaleInstalled answers whether glibc's setlocale would load the locale name (not C or POSIX, which every box has):
// the name as given and then with its codeset normalized (lowercased, punctuation dropped: `UTF-8` is `utf8`), looked
// for under each directory of LOCPATH when it is set, else under /usr/lib/locale's directories and in its archive
// (inArchive). C.UTF-8 is built into glibc from 2.35. Measured on the bench: the box's own locales, and a LOCPATH that
// localedef filled (testdata/locale-locpath.golden); the archive arm is held to an archive localedef built, not to bash.
// With LOCPATH set the system archive is not consulted, as glibc's findlocale.c reads; that pairing is not measured
// (the bench has no system archive). shortcut: no alias expansion (locale.alias) and no language-territory fallback; a
// name with neither installed reads as missing, where glibc could still find it (D-TBD-go-hook-locale-lookup). On
// Windows the answer is MSYS2's setlocale's (cygwinLocale); on macOS every name reads as installed (the hook stays bash
// there).
func LocaleInstalled(name string) bool {
	if runtime.GOOS == "windows" {
		return cygwinLocale(name)
	}
	if runtime.GOOS != "linux" {
		return true
	}
	if name == "" || strings.Contains(name, "/") {
		return false
	}
	names := []string{name}
	if lang, cs, ok := strings.Cut(name, "."); ok {
		mod := ""
		if i := strings.IndexByte(cs, '@'); i >= 0 {
			cs, mod = cs[:i], cs[i:]
		}
		var b strings.Builder
		for _, r := range strings.ToLower(cs) {
			if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
				b.WriteRune(r)
			}
		}
		if n := lang + "." + b.String() + mod; n != name {
			names = append(names, n)
		}
		if lang == "C" && b.String() == "utf8" && mod == "" {
			return true
		}
	}
	dirs := []string{localeDir}
	lp := os.Getenv("LOCPATH")
	if lp != "" {
		dirs = filepath.SplitList(lp)
	}
	for _, d := range dirs {
		for _, n := range names {
			if st, err := os.Stat(filepath.Join(d, n, "LC_CTYPE")); err == nil && !st.IsDir() {
				return true
			}
		}
	}
	if lp != "" {
		return false
	}
	for _, n := range names {
		if inArchive(filepath.Join(localeDir, "locale-archive"), n) {
			return true
		}
	}
	return false
}

// inArchive is glibc's archive lookup (locale/loadarchive.c): the name's hash (locale/hashval.h over 32 bits) probes the
// archive's name table by double hashing, and a slot's name is compared whole. It reads the header, the slots it probes
// and the names they point at, never the whole archive.
func inArchive(path, name string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	u32 := func(off int64) (uint32, bool) {
		var b [4]byte
		if _, err := f.ReadAt(b[:], off); err != nil {
			return 0, false
		}
		return binary.NativeEndian.Uint32(b[:]), true
	}
	if magic, ok := u32(0); !ok || magic != 0xde020109 {
		return false
	}
	tab, ok1 := u32(8)   // namehash_offset
	size, ok2 := u32(16) // namehash_size
	if !ok1 || !ok2 || size < 3 {
		return false
	}
	hval := uint32(len(name))
	for i := 0; i < len(name); i++ {
		hval = (hval<<9 | hval>>23) + uint32(name[i])
	}
	if hval == 0 {
		hval = ^uint32(0)
	}
	idx, incr := hval%size, 1+hval%(size-2)
	for probes := uint32(0); probes < size; probes++ {
		slot := int64(tab) + int64(idx)*12 // namehashent: hashval, name_offset, locrec_offset
		h, ok1 := u32(slot)
		off, ok2 := u32(slot + 4)
		if !ok1 || !ok2 || off == 0 {
			return false
		}
		if h == hval {
			b := make([]byte, len(name)+1)
			if _, err := f.ReadAt(b, int64(off)); err == nil && string(b[:len(name)]) == name && b[len(name)] == 0 {
				return true
			}
		}
		if idx += incr; idx >= size {
			idx -= size
		}
	}
	return false
}
