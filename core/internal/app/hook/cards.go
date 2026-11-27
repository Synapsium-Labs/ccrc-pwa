package hook

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"ccrc/core/internal/domain/attention"
	"ccrc/core/internal/kernel/vocab"
)

// The SessionStart card pipeline's reads and acts (wave 2 inventory §2F): attention decides every subject; these read
// what it asks for, as the bash reads it, and act on the memory convergence it decides.

// cards is the arm's subjects, in the bash's order: the memory convergence first (it prints nothing), the anchor's slot,
// the graphify card, the program subject, the role card only while the anchor's slot is empty, the co-tenant subject,
// the roster card, and on a compact start the compact card (compaction.go) with the history line folded in.
func (h *run) cards(ps attention.Parsed, src string) (cards attention.Cards, word string) {
	h.memoryConverge(ps)
	if form := attention.AnchorSource(src); form != "" {
		w, t, _ := h.anchorFetch(form, ps)
		word = w
		cards.Anchor = attention.AnchorSlot(form, w, t)
	}
	off := h.exists(filepath.Join(h.home, ".ccrc", vocab.CcrcCardOffFile))
	g, rc := attention.MeasureGraph(ps.Payload, h.graphIO())
	graph := attention.GraphCard(g, rc, h.sweepRow(g, rc), h.exists(filepath.Join(h.home, ".ccrc", vocab.GraphGateOffFile)), h.utf8)
	hold, role, ccrc := "", "", ""
	if !off {
		hold = attention.HoldCard(h.id, h.ctRead, func(n string) bool { return h.exists(h.p(n)) }, g.CWD, h.utf8)
	}
	if cards.Anchor == "" {
		role = h.roleCard(src)
	}
	if !off {
		ccrc = attention.CcrcCard(h.id, h.uuidRows(), h.ctRead, h.NowMs()/1000, h.utf8)
	}
	cards.Standing = attention.Standing(graph, hold, role, ccrc)
	if attention.CardsRoster(src) {
		cards.Roster = h.rosterCard(src, ps)
	}
	if src == "compact" {
		cards.Compact = attention.HistoryCard(h.id, ps.Psid, ps.Paid, h.compactCard(), h.historyIO(), h.utf8)
	}
	return cards, word
}

// roleCard is `_hook_role_card`'s reads: the kill switch, the child marker and the hold.
func (h *run) roleCard(src string) string {
	child := h.p(h.id + ".child")
	return attention.RoleCard(src, h.exists(filepath.Join(h.home, ".ccrc", vocab.CcrcCardOffFile)), h.exists(child), h.isLink(child), h.exists(h.p(h.id+".hold")))
}

// uuidRows is `for f in "$REG"/*.uuid`: each row's id (a dot-led name is no row; with no match, the unexpanded word, whose
// `*` id no shape gate passes).
func (h *run) uuidRows() []string {
	fs, _ := h.FS.Glob(filepath.Join(h.reg, "*.uuid"))
	rows := make([]string, 0, len(fs))
	for _, f := range fs {
		rows = append(rows, strings.TrimSuffix(filepath.Base(f), ".uuid"))
	}
	return rows
}

// sweepRow is the census arm's reads: the tree's common directory, as a physical path (`cd -- "$GM_CWD" && cd -- "$gcd"
// && pwd -P`), and the sweep's census file, read whole as jq reads it.
func (h *run) sweepRow(g attention.Graph, rc int) string {
	if rc != 1 {
		return ""
	}
	src := ""
	if gcd, ok := h.Git(g.CWD, "rev-parse", "--git-common-dir"); ok && gcd != "" && h.physDir(g.CWD) != "" {
		src = h.physDirFrom(g.CWD, gcd)
	}
	b, err := h.FS.ReadFile(filepath.Join(h.home, ".ccrc", "graph-sweep.json"), 0)
	return attention.SweepRow(b, err == nil, src)
}

// physDirFrom is `cd -- base && cd -- p && pwd -P`: p relative to base's logical path when it is relative.
func (h *run) physDirFrom(base, p string) string {
	if h.GOOS == "windows" {
		return h.msysPwd(base, p)
	}
	if !strings.HasPrefix(p, "/") {
		p = strings.TrimSuffix(base, "/") + "/" + p
	}
	return h.physDir(p)
}

// physDir is `$(cd -- p && pwd -P)`: bash's cd is logical, so a `..` is taken off the path's text (after checking the
// path before it is a directory, else bash falls back to the path as the system resolves it), and `pwd -P` is then the
// physical directory. "" when cd fails (no such directory, or one that cannot be searched). shortcut: CDPATH is not
// consulted, which bash's `cd` does for a relative path that starts with neither `/` nor `.` (D-TBD-go-hook-cd-cdpath).
func (h *run) physDir(p string) string {
	if p == "" {
		return ""
	}
	if h.GOOS == "windows" {
		return h.msysPwd(p)
	}
	if !strings.HasPrefix(p, "/") {
		wd, err := filepath.Abs(".")
		if err != nil {
			return ""
		}
		p = strings.TrimSuffix(wd, "/") + "/" + p
	}
	target := p
	cur := ""
	for _, c := range strings.Split(p, "/") {
		switch c {
		case "", ".":
			continue
		case "..":
			if st, err := h.FS.Stat(cur + "/"); err != nil || !st.IsDir() {
				cur = "\x00" // the logical path fails its check
			} else if i := strings.LastIndexByte(cur, '/'); i >= 0 {
				cur = cur[:i]
			}
		default:
			cur += "/" + c
		}
		if cur == "\x00" {
			break
		}
	}
	if cur != "\x00" {
		target = cur
		if target == "" {
			target = "/"
		}
	}
	for _, t := range []string{target, p} {
		if r, err := h.FS.EvalSymlinks(t); err == nil {
			if st, err := h.FS.Stat(r); err == nil && st.IsDir() && h.FS.Executable(r) {
				return r
			}
		}
	}
	return ""
}

// msysPwd is `$(cd -- d1 && cd -- d2 … && pwd -P)` asked of MSYS2's bash itself, the hook's shell on Windows: its
// answer is MSYS2's spelling (/c/…, a mount such as /tmp read back), which the bash hook compares and slugs (the graph
// sweep's `source`, the memory store's slug), and a payload's cwd arrives there in Windows form, which the logical walk
// above cannot read. One fork, on SessionStart's memory convergence and the census line only. "" when it fails.
func (h *run) msysPwd(dirs ...string) string {
	script := ""
	for i := range dirs {
		script += `cd -- "$` + strconv.Itoa(i+1) + `" >/dev/null 2>&1 && `
	}
	r := h.Run(0, nil, nil, false, "bash", append([]string{"-c", script + "pwd -P", "_"}, dirs...)...)
	if r.Rc != 0 {
		return ""
	}
	return r.Sub()
}

// memoryConverge is `_hook_memory_converge`'s acts, each an external the bash runs (`rmdir`, `mkdir -p`, `ln -sn`) and
// so skipped where PATH holds none, as the bash's fails.
func (h *run) memoryConverge(ps attention.Parsed) {
	gio := h.graphIO()
	a := attention.MemoryConverge(ps.Payload, attention.MemoryIO{
		Home: h.home, Workdir: gio.Workdir, IsDir: gio.IsDir, IsLink: gio.IsLink, Exists: h.exists,
		SameFile: func(a, b string) bool {
			sa, ea := h.FS.Stat(a)
			sb, eb := h.FS.Stat(b)
			return ea == nil && eb == nil && os.SameFile(sa, sb)
		},
		Readlink: func(p string) (string, bool) {
			if !h.Found("readlink") {
				return "", false
			}
			t, err := h.FS.Readlink(p)
			return t, err == nil
		},
		Git:     h.Git,
		PhysDir: h.physDir,
	}, h.utf8)
	if a.Link == "" {
		return
	}
	mkdir := func() bool { return h.Found("mkdir") && h.FS.MkdirAll(a.Store, 0o777) == nil }
	if a.StoreOnly {
		mkdir()
		return
	}
	if a.Rmdir && (!h.Found("rmdir") || h.FS.Rmdir(a.Link) != nil) {
		return
	}
	if mkdir() && h.Found("ln") {
		// D-TBD-go-hook-ln-into-dir: a directory made at the link between the rmdir and here fails the symlink; bash's
		// `ln -sn` would put the link inside it (both leave the store unconverged, doctor reports it)
		_ = h.FS.Symlink(a.Store, a.Link)
	}
}

// historyIO is the history card's reads, every path absolute.
func (h *run) historyIO() attention.HistoryIO {
	return attention.HistoryIO{
		Home: h.home, Gen: h.Getenv("CCRC_SESSION_GENERATION"), Registry: h.reg, NowMs: h.NowMs(),
		Exists: h.exists, IsLink: h.isLink,
		IsDir:  func(p string) bool { st, err := h.FS.Stat(p); return err == nil && st.IsDir() },
		Exec:   h.FS.Executable,
		IsFile: h.isRegular,
		CtRead: h.ctReadPath,
		Read: func(p string) ([]byte, bool) {
			b, err := h.FS.ReadFile(p, 0)
			return b, err == nil
		},
	}
}
