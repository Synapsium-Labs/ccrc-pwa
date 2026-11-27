package attention

import "strings"

// Memory convergence (ccd/session-hook.sh, `_hook_memory_converge`): one memory store per project,
// `~/.ccrc/memory/<slug>`, and the harness's per-home `<config dir>/projects/<slug>/memory` a link to it. The slug is
// the project root's (the main checkout's, through `git rev-parse --git-common-dir`), and the project directory must
// already exist. It never merges: it acts only on an absent link or an empty directory, and on a link that already names
// the store but whose store is missing. Every failure is silence.

// MemoryIO is what the convergence reads.
type MemoryIO struct {
	Home     string
	Workdir  func() string                                   // `cat $REG/<id>.workdir`, raw: "" when it cannot be read
	IsDir    func(p string) bool                             // `[ -d p ]`
	IsLink   func(p string) bool                             // `[ -L p ]`
	Exists   func(p string) bool                             // `[ -e p ]`
	SameFile func(a, b string) bool                          // `[ a -ef b ]`
	Readlink func(p string) (string, bool)                   // `$(readlink -- p)`
	Git      func(dir string, args ...string) (string, bool) // `git -C dir args…` as `$( )` keeps it
	PhysDir  func(p string) string                           // `$(cd -- p && pwd -P)`: "" when cd fails
}

// MemoryAct is what the hook does: nothing (Link ""), create the missing store behind a link that names it
// (StoreOnly), or converge: rmdir the empty directory first (Rmdir), `mkdir -p` the store, then `ln -sn` it at Link,
// stopping at the first step that fails.
type MemoryAct struct {
	Link, Store      string
	StoreOnly, Rmdir bool
}

// MemoryConverge decides the convergence for this payload.
func MemoryConverge(payload any, io MemoryIO, utf bool) MemoryAct {
	tv, err := index(payload, "transcript_path") // `jq -r '.transcript_path // empty' || return 0`
	if err != nil || !truthy(tv) {
		return MemoryAct{}
	}
	tp := cmdSub(rawOut(tv))
	i := strings.LastIndexByte(tp, '/')
	if i < 0 {
		return MemoryAct{}
	}
	d := tp[:i]
	if !io.IsDir(d) {
		return MemoryAct{}
	}
	j := strings.LastIndexByte(d, '/')
	if j < 0 {
		return MemoryAct{}
	}
	projects := d[:j]
	if !strings.HasSuffix(projects, "/projects") {
		return MemoryAct{}
	}
	cwd := ""
	if c := get(payload, "cwd"); truthy(c) {
		cwd = cmdSub(rawOut(c))
	}
	if cwd == "" {
		cwd = cmdSub(io.Workdir())
	}
	if cwd == "" || !io.IsDir(cwd) {
		return MemoryAct{}
	}
	gcd, ok := io.Git(cwd, "rev-parse", "--git-common-dir")
	if !ok {
		gcd = ""
	}
	var root string
	switch {
	case gcd == "":
		root = io.PhysDir(cwd)
	case strings.HasPrefix(gcd, "/"):
		root = io.PhysDir(gcd + "/..")
	default:
		root = io.PhysDir(cwd + "/" + gcd + "/..")
	}
	if root == "" {
		return MemoryAct{}
	}
	slug := MemorySlug(root, utf)
	if MemoryScratch(slug) || !io.IsDir(projects+"/"+slug) {
		return MemoryAct{}
	}
	link := projects + "/" + slug + "/memory"
	store := io.Home + "/.ccrc/memory/" + slug
	if io.IsLink(link) {
		if io.SameFile(link, store) && io.IsDir(store) {
			return MemoryAct{}
		}
		if t, _ := io.Readlink(link); t == store && !io.IsDir(store) {
			return MemoryAct{Link: link, Store: store, StoreOnly: true}
		}
		return MemoryAct{}
	}
	return MemoryAct{Link: link, Store: store, Rmdir: io.Exists(link)}
}

// MemorySlug is `${root//[!$ok]/-}`: every character (byte, in a C locale) outside the spelled-out ASCII alphabet, digits
// and `-` becomes one `-`.
func MemorySlug(root string, utf bool) string {
	var b strings.Builder
	keep := func(c rune) bool {
		return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-'
	}
	if !utf {
		for i := 0; i < len(root); i++ {
			if keep(rune(root[i])) {
				b.WriteByte(root[i])
			} else {
				b.WriteByte('-')
			}
		}
		return b.String()
	}
	for _, r := range root {
		if keep(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}

// MemoryScratch is the scratch slugs' case: `-tmp*|-private-tmp*|-var-folders*|-private-var-folders*|*--cc-tmp-*` (the OS
// scratch roots of both platforms and a marked child's `$HOME/.cc-tmp/<id>`), which accumulate no durable memory.
func MemoryScratch(slug string) bool {
	for _, p := range []string{"-tmp", "-private-tmp", "-var-folders", "-private-var-folders"} {
		if strings.HasPrefix(slug, p) {
			return true
		}
	}
	return strings.Contains(slug, "--cc-tmp-")
}
