package hook

import (
	"io/fs"
	"path/filepath"
	"strings"

	"ccrc/core/internal/domain/attention"
	"ccrc/core/internal/kernel/vocab"
)

// The spools and the launch record: tail stages 6 to 8 (ccd/session-hook.sh, the `history-spool`, `delegation-spool` and
// `launch-record` blocks). attention decides what is written; this file stats, reads and writes in the bash's order.

// built is what the parse and the spool's gate produced before any file is written (the bash builds them in the one
// payload parse, so the clock and the incarnation are read there).
type built struct {
	gate attention.Gate
	sp   attention.SpoolOut
	row  string
}

func (h *run) isLink(p string) bool {
	st, err := h.FS.Lstat(p)
	return err == nil && st.Mode()&fs.ModeSymlink != 0
}

// dirNoLink is `[[ -d p && ! -L p ]]`.
func (h *run) dirNoLink(p string) bool {
	st, err := h.FS.Lstat(p)
	return err == nil && st.IsDir()
}

func (h *run) present(p string) bool { _, err := h.FS.Lstat(p); return err == nil }

// readN is `read -r -N n` of a file: its first n bytes, NUL bytes dropped ("" when it cannot be opened).
// D-TBD-go-hook-reads-in-bytes: bash counts characters in a UTF-8 locale; every value read matches an ASCII grammar and
// ccd writes the files, so bytes and characters differ in no file that matches.
func (h *run) readN(p string, n int) string {
	b, _ := h.FS.ReadFile(p, n)
	return attention.NulFree(b)
}

// buildSpool is the gate and the two parse outputs the spool and the launch record share.
func (h *run) buildSpool(ps attention.Parsed, payload string) built {
	goos := h.GOOS
	if goos == "" {
		goos = "linux"
	}
	in := attention.GateIn{ID: h.id, EnvGen: h.Getenv("CCRC_SESSION_GENERATION"), Payload: payload,
		ExecPath: h.Getenv("CLAUDE_CODE_EXECPATH"), Below: h.lineBelow(goos)}
	gen := h.p(h.id + ".generation")
	if !strings.HasPrefix(h.id, ".") && len(h.id) <= vocab.HookConstantsCcrcIdMax && h.regular(gen) {
		in.GenRaw = h.readN(gen, 37)
	}
	dir := h.p("delegation/spool/" + h.id)
	in.SpoolDirOK = h.dirNoLink(dir) && !h.isLink(filepath.Dir(dir)) && !h.isLink(filepath.Dir(filepath.Dir(dir)))
	deleg := h.p(h.id + ".deleg")
	in.DelegOK = !h.exists(deleg) || h.regular(deleg)
	in.WrapperRaw = func() string {
		if w := h.p(h.id + ".wrapper"); h.regular(w) {
			return h.readN(w, 65)
		}
		return ""
	}
	g := attention.GateDecide(in)
	b := built{gate: g}
	if g.Gen == "" {
		return b
	}
	si := attention.SpoolIn{ID: h.id, Gen: g.Gen, Ver: g.Ver, Below: g.Below, NowMs: h.NowMs()}
	if g.Spool {
		b.sp = attention.SpoolLine(ps, si)
	}
	if g.Lrec {
		b.row = attention.LaunchRow(ps, si, g.Wrapper)
	}
	return b
}

// historySpool is tail stage 6: one fenced line appended to `~/.ccrc/history/spool/<id>.jsonl`.
func (h *run) historySpool(ps attention.Parsed, c attention.Class) {
	hdir := filepath.Join(h.home, ".ccrc", "history", "spool")
	line := attention.HistoryLine(attention.HistoryIn{ID: h.id, Event: ps.Event, Src: c.Src, Psid: ps.Psid, Trig: c.Trig,
		Paid: ps.Paid, SpoolDirOK: h.dirNoLink(hdir), Off: h.exists(filepath.Join(h.home, ".ccrc", "history-off")),
		Gen: h.Getenv("CCRC_SESSION_GENERATION"), NowMs: h.NowMs(),
		RegUUID: func() string {
			u := h.p(h.id + ".uuid")
			if st, err := h.FS.Stat(u); err != nil || !st.Mode().IsRegular() {
				return ""
			}
			b, _ := h.FS.ReadFile(u, 128)
			return attention.CtRead(b)
		}})
	if line != "" {
		_ = h.FS.AppendRegular(filepath.Join(hdir, h.id+".jsonl"), []byte("\n"+line+"\n"))
	}
}

// delegationSpool is tail stage 7: `_hook_spool_append`, silent, never fatal.
func (h *run) delegationSpool(b built) {
	if b.sp.Line == "" {
		return
	}
	line, ok := attention.SpoolAppendLine(b.sp.Line, b.sp.Cwd, b.gate.Below, h.listing)
	if !ok || !attention.SpoolBucketOK(b.sp.Bucket, b.gate.Gen) {
		return
	}
	g := h.p(h.id + ".generation")
	if !h.regular(g) || h.readN(g, 37) != b.gate.Gen {
		return
	}
	dir := h.p("delegation/spool/" + h.id)
	if !h.dirNoLink(dir) {
		return
	}
	f := filepath.Join(dir, b.sp.Bucket+".spool")
	// ABSENCE FIRST (D-7448): the file is absent or a regular file, and a link is neither.
	if h.present(f) && !h.regular(f) {
		return
	}
	fresh := !h.present(f)
	if h.FS.AppendFile(f, []byte(line+"\n")) != nil {
		return
	}
	if fresh {
		names, _ := h.FS.ReadDirNames(dir)
		for _, n := range attention.PruneOld(names, b.sp.Cut, func(n string) bool { return h.regular(filepath.Join(dir, n)) }) {
			_ = h.FS.Remove(filepath.Join(dir, n))
		}
	}
}

// listing is `_hook_spool_listing` over the real tree.
func (h *run) listing(cwd string) attention.Listing {
	return attention.SpoolListing(cwd, attention.ListingReads{
		DirNoLink:  h.dirNoLink,
		FileNoLink: h.regular,
		Head:       func(p string) string { return h.readN(p, 1024) },
		IsDir:      func(p string) bool { st, err := h.FS.Stat(p); return err == nil && st.IsDir() },
		Present:    h.present,
		Searchable: h.FS.Searchable,
		DirNames:   func(p string) ([]string, bool) { n, err := h.FS.ReadDirNames(p); return n, err == nil },
	})
}

// launchRecord is tail stage 8: `_hook_launch_record_append`, silent, never fatal. D-TBD-go-hook-pair-one-write: the pair is one
// `write(2)`, where bash's two-line `printf` is one write only when it fits stdout's buffer (same bytes either way).
func (h *run) launchRecord(b built) {
	f, g := h.p(h.id+".deleg"), h.p(h.id+".generation")
	if h.isLink(f) || (h.present(f) && !h.regular(f)) || b.gate.Gen == "" || !h.regular(g) || h.readN(g, 37) != b.gate.Gen {
		return
	}
	var size int64
	if h.present(f) {
		st, err := h.FS.Stat(f)
		if err != nil {
			return // `wc -c` that cannot read: unmeasured
		}
		size = st.Size()
	}
	text, ok := attention.LaunchAppend(b.row, size, true, b.gate.Below, h.NowMs())
	if !ok {
		return
	}
	_ = h.FS.AppendFile(f, []byte(text))
	if !h.exists(g) { // the row was purged under this write: the other half of `_reg_purge`'s unlink (D-8367)
		_ = h.FS.Remove(f)
	}
}

// ostypeSet says whether OSTYPE is in the environment, an empty one included: bash keeps an imported one.
func (h *run) ostypeSet() bool {
	if h.LookupEnv != nil {
		_, ok := h.LookupEnv("OSTYPE")
		return ok
	}
	return h.Getenv("OSTYPE") != ""
}

// lineBelow is `DSP_LINE_BELOW` (D-TBD-go-hook-musl-cap: the libc test is a musl loader under `/lib`; a box with a musl bash and
// no loader there is not a fleet box). Bash's second libc test (BASH_VERSINFO[5]) is read off the box's loaders rather than by
// forking a bash (the hook's hot path forks nothing): a musl loader with no glibc loader beside it is a musl box. Debian
// and Ubuntu install musl's loader beside glibc's, and there bash says glibc, so a musl loader alone decides nothing.
func (h *run) lineBelow(goos string) int {
	musl := false
	if goos == "linux" {
		found := func(p string) bool { m, _ := h.FS.Glob(p); return len(m) > 0 }
		musl = found("/lib/ld-musl-*.so.1") && !found("/lib64/ld-linux-*") && !found("/lib/*-linux-gnu/ld-linux-*") && !found("/lib/ld-linux-*")
	}
	return attention.LineBelow(goos, h.Getenv("OSTYPE"), h.ostypeSet(), musl)
}
