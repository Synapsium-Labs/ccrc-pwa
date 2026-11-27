package hook

import (
	"io/fs"
	"path/filepath"
	"strings"

	"ccrc/core/internal/domain/attention"
	"ccrc/core/internal/kernel/vocab"
)

// preTool is tail stage 12 for the arms attention.PreToolArms decides: it hands the decider what stage 10 read and the
// observations it may ask for (each answered only when asked, as the bash asks it), and acts on nothing itself.
func (h *run) preTool(ps attention.Parsed, c attention.Class, payload string, prev attention.Prev, tmsub bool) attention.PreOut {
	in := attention.PreIn{Tool: c.Tool, Payload: payload, V: ps.Payload, Paid: ps.Paid, Tmsub: tmsub, Subs: prev.Subs,
		Unreadable: prev.Unreadable, Paned: h.Getenv("TMUX_PANE") != "", Gq: prev.Gq, Gd: prev.Gd, UTF8: h.utf8,
		GateOff: h.exists(filepath.Join(h.home, ".ccrc", vocab.GraphGateOffFile)),
		GOOS:    h.GOOS,
		OSType:  h.Getenv("OSTYPE"), OSTypeSet: h.ostypeSet(), DoorNonce: h.Getenv("CCRC_DOOR_NONCE_SHA256"), Force: h.Getenv("CLAUDE_CODE_SUBAGENT_MODEL_FORCE"),
		SubagentModel: h.Getenv("CLAUDE_CODE_SUBAGENT_MODEL"), ID: h.id, Home: h.home, Miss: h.id == ""}
	return attention.PreToolArms(in, attention.PreReads{
		Graph:      h.graphIO(),
		Generation: func() bool { return h.isRegular(h.p(h.id + ".generation")) },
		ScriptStat: h.scriptStat,
		ScriptText: h.scriptText,
		HasCcrc:    func() bool { return h.Found("ccrc") },
		Classify:   h.Classify,
		Reg:        h.ctRead,
		Exists:     func(name string) bool { return h.exists(h.p(name)) },
		AdminAllowed: func(project string) bool {
			_, ok := h.regularNoLink(h.p(filepath.Join("admin-merge-allowed", project)))
			return ok
		},
		DenyFile: func() ([]byte, bool) {
			f := h.p("child-deny.settings.json")
			if st, err := h.FS.Lstat(f); err != nil || st.Mode()&fs.ModeSymlink != 0 {
				return nil, false
			}
			if !h.isRegular(f) {
				return nil, false
			}
			b, _ := h.FS.ReadFile(f, attention.DenyReadMax)
			return b, true
		},
	})
}

// graphIO is the graph measurement's reads: the registry's files and git through PATH.
func (h *run) graphIO() attention.GraphIO {
	return attention.GraphIO{
		Home: h.home, UTF8: h.utf8,
		Workdir: func() string {
			b, err := h.FS.ReadFile(h.p(h.id+".workdir"), 0)
			if err != nil {
				return ""
			}
			return strings.TrimRight(strings.ReplaceAll(string(b), "\x00", ""), "\n")
		},
		IsDir:  func(p string) bool { st, err := h.FS.Stat(p); return err == nil && st.IsDir() },
		IsLink: func(p string) bool { st, err := h.FS.Lstat(p); return err == nil && st.Mode()&fs.ModeSymlink != 0 },
		IsFile: func(p string) bool { st, err := h.FS.Stat(p); return err == nil && st.Mode().IsRegular() },
		Head:   func(p string, n int) []byte { b, _ := h.FS.ReadFile(p, n); return b },
		Tail:   func(p string, n int) []byte { b, _ := h.FS.ReadTail(p, n); return b },
		Git:    h.Git,
		NowSec: func() int64 { return h.NowMs() / 1000 },
	}
}

// ctRead is `_ct_read`'s file test and read: rc 1 for nothing there, 2 for no readable regular file, 0 with its bytes.
func (h *run) ctRead(name string) ([]byte, int) { return h.ctReadPath(h.p(name)) }

// ctReadPath is ctRead over any path.
func (h *run) ctReadPath(p string) ([]byte, int) {
	st, err := h.FS.Stat(p) // `-e` and `-f` follow a link
	if err != nil {
		return nil, 1
	}
	if !st.Mode().IsRegular() {
		return nil, 2
	}
	b, err := h.FS.ReadFile(p, 0)
	if err != nil {
		return nil, 2 // `-r`: it cannot be read
	}
	return b, 0
}

// isRegular is `[[ -f p ]]`: through a link.
func (h *run) isRegular(p string) bool {
	st, err := h.FS.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

// scriptStat is `[[ -f p && ! -L p ]]` and the file's size.
func (h *run) scriptStat(p string) (bool, int64) {
	st, err := h.FS.Lstat(p)
	if err != nil || !st.Mode().IsRegular() {
		return false, 0
	}
	return true, st.Size()
}

// scriptText is `cat -- p`.
func (h *run) scriptText(p string) string {
	b, err := h.FS.ReadFile(p, 0)
	if err != nil {
		return ""
	}
	return string(b)
}
