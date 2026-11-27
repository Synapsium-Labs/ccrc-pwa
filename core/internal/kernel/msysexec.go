package kernel

import "strings"

// MsysExecutable is MSYS2's `-x` for a file on Windows (its filesystems are mounted noacl, so there is no execute bit to
// read): a name ending in .exe or .lnk, whatever is in it, or a file whose first bytes are `#!`, `MZ` or `:\n`.
// Measured on MSYS2 bash: .cmd, .bat and .com files, an empty file, plain text, ` #!`, `M` and `:\r\n` are not
// executable. head is the file's first bytes (three are enough). A directory is the caller's (`-x` is searchable there).
// The one rule behind regfs.Executable and the core's command lookup on Windows (proc.Command), so the hook's
// `-x ~/.local/bin/ccrc-api` and the run that follows it agree.
func MsysExecutable(name string, head []byte) bool {
	n := strings.ToLower(name)
	if strings.HasSuffix(n, ".exe") || strings.HasSuffix(n, ".lnk") {
		return true
	}
	h := string(head)
	return strings.HasPrefix(h, "#!") || strings.HasPrefix(h, "MZ") || strings.HasPrefix(h, ":\n")
}

// MsysQuoteArg is one argument of a Windows command line for a native (Microsoft C runtime) program to read back exactly,
// always in double quotes: backslashes are doubled only where they precede a quote (the closing one included). It is NOT
// what an MSYS2 program reads: MSYS2's runtime halves every run of backslashes inside quotes (`a\\b` reads `a\b`,
// measured in Go core wave 3, Task 10), so a program MSYS2 runs takes CygwinQuoteArg.
func MsysQuoteArg(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	slashes := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '\\':
			slashes++
			continue
		case '"':
			b.WriteString(strings.Repeat(`\`, 2*slashes+1))
		default:
			b.WriteString(strings.Repeat(`\`, slashes))
		}
		slashes = 0
		b.WriteByte(c)
	}
	b.WriteString(strings.Repeat(`\`, 2*slashes))
	b.WriteByte('"')
	return b.String()
}

// CygwinQuoteArg is one argument of a Windows command line for a program MSYS2's runtime starts (bash, tmux, flock, cat,
// cygpath) to read back exactly: in double quotes, as MSYS2 expands an unquoted argument as a glob, with every backslash
// doubled and every quote escaped, because MSYS2 reads `\\` inside quotes as one backslash wherever it stands and `\"`
// as a quote (measured against MSYS2's bash: interior runs of two and four, trailing runs, `\"`, `$'\303'`; Go core wave
// 3, Task 10). A single interior backslash also reads back as one under MsysQuoteArg; a run of two or more does not.
func CygwinQuoteArg(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}
