package hook

import (
	"io/fs"
	"path/filepath"
	"strconv"

	"ccrc/core/internal/domain/attention"
)

// mailHold is tail stage 13, `_hook_mail_hold`: attention.MailHold decides, the module's two jq processes run here, and
// what it answers is written: the seen file (a temporary file in its directory, moved over) and the shadow log (rotated
// to `.1` past 1 MiB, then appended), only when a log line is due and its directory can be made.
func (h *run) mailHold(ps attention.Parsed, c attention.Class, payload string, tmsub bool) string {
	d := filepath.Join(h.home, ".ccrc", "mail-hold-shadow.d")
	logf := filepath.Join(h.home, ".ccrc", "mail-hold-shadow.log")
	lib := h.lib()
	in := []byte(payload + "\n") // `<<<"$payload"`
	o := attention.MailHold(attention.MailHoldIn{Event: ps.Event, Tool: c.Tool, Payload: payload, ID: h.id, V: ps.Payload, Tmsub: tmsub,
		NowSec: h.NowMs() / 1000, UTF8: h.utf8}, attention.MailHoldIO{
		Marker:   func() ([]byte, bool) { return h.regularNoLink(h.p(h.id + ".mailhold")) },
		Disabled: func() bool { return h.exists(h.p("mail-disabled")) },
		Seen:     func() ([]byte, bool) { return h.regularNoLink(filepath.Join(d, h.id)) },
		Module:   func() bool { return h.isRegular(filepath.Join(lib, "mail-hold.jq")) },
		Armed: func() string {
			a := ""
			if h.exists(h.p("mailhold-notice-live")) {
				a = "notice"
			}
			if h.exists(h.p("mailhold-refuse-live")) {
				a += ",refuse"
			}
			return a
		},
		Prep: func() (any, bool) {
			out, ok, _ := h.JQ(in, "-L", lib, "-c", `include "mail-hold"; mh_prep`)
			if !ok {
				return nil, false
			}
			return attention.MailHoldPrep(out)
		},
		LogSize: func() (int64, bool) {
			st, err := h.FS.Lstat(logf)
			if err != nil {
				return 0, false
			}
			return st.Size(), true
		},
		Call: func(args [][2]string) (string, bool) {
			argv := []string{"-L", lib, "-j"}
			for _, a := range args {
				argv = append(argv, "--arg", a[0], a[1])
			}
			out, _, handed := h.JQ(in, append(argv, `include "mail-hold"; mail_hold($ARGS.named)`)...)
			return string(out), handed
		},
	})
	if o.Log == "" || h.FS.MkdirAll(d, 0o777) != nil {
		return o.Pre
	}
	if o.Seen != "" {
		tmp := filepath.Join(d, "."+h.id+"."+strconv.Itoa(h.Pid))
		if h.FS.WriteFile(tmp, []byte(o.Seen), 0o666) != nil || h.FS.Rename(tmp, filepath.Join(d, h.id)) != nil {
			_ = h.FS.Remove(tmp)
		}
	}
	if o.Rotate {
		_ = h.FS.Rename(logf, logf+".1")
	}
	_ = h.FS.AppendFile(logf, []byte(o.Log))
	return o.Pre
}

// regularNoLink is `[[ -f p && ! -L p ]]` and the file's bytes (false when it is not, or cannot be read: `read` then
// reads nothing).
func (h *run) regularNoLink(p string) ([]byte, bool) {
	st, err := h.FS.Lstat(p)
	if err != nil || st.Mode()&fs.ModeSymlink != 0 || !st.Mode().IsRegular() {
		return nil, false
	}
	b, _ := h.FS.ReadFile(p, 0)
	return b, true
}

// lib is ROSTER_CARD_LIB, decided by attention.RosterCardLib from whether the lib/ beside the core holds roster-card.jq.
func (h *run) lib() string {
	return attention.RosterCardLib(h.LibDir != "" && h.isRegular(filepath.Join(h.LibDir, "roster-card.jq")), h.LibDir, h.home)
}
