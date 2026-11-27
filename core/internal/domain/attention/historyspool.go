package attention

import (
	"strconv"
	"strings"

	"ccrc/core/internal/kernel/vocab"
)

// SpoolIDMax is the history spool's id bound (SPOOL_ID_MAX): `.draining/<id>.<ms>.<pid>.jsonl` must fit a 255-byte name;
// the history card's id bound is the same fact (`(( ${#id} <= 224 ))`).
const SpoolIDMax = vocab.SpoolIdMax

// HistoryIn is what the history spool's gate observes (ccd/session-hook.sh, the `history-spool` block).
type HistoryIn struct {
	ID, Event, Src, Psid, Trig string
	Paid                       bool
	SpoolDirOK                 bool   // `~/.ccrc/history/spool` is a directory and not a link: the hook never makes it
	Off                        bool   // `~/.ccrc/history-off` exists
	Gen                        string // CCRC_SESSION_GENERATION
	NowMs                      int64
	RegUUID                    func() string // `_ct_read` of `<id>.uuid`, asked only for a startup, resume or fork start
}

// CtRead is `_ct_read`'s value: a read of at most CCRC_ID_MAX characters, NUL bytes dropped, trimmed of [:space:] at both
// ends. shortcut: ASCII space classes and bytes for characters; no `.uuid` ccd writes holds anything else (D-TBD-go-hook-ctread-classes).
func CtRead(b []byte) string {
	s := strings.ReplaceAll(string(b), "\x00", "")
	return strings.Trim(cut(s, 128), " \t\n\v\f\r")
}

// HistoryLine is the history spool's one text-free JSON line for the event, or "" when none is due: the main thread
// only, the spool directory already there, a Stop or PostCompact unless history is off, a SessionStart only with a
// lowercase-UUID sid and a startup, resume, clear or fork source. Fields the whitelist refuses are left out, never
// written wrong.
func HistoryLine(in HistoryIn) string {
	if in.Paid || !in.SpoolDirOK || len(in.ID) > SpoolIDMax {
		return ""
	}
	var head string
	switch in.Event {
	case "Stop", "PostCompact":
		if in.Off {
			return ""
		}
		head = `{"v":1,"ev":"` + in.Event + `"`
	case "SessionStart":
		switch in.Src {
		case "startup", "resume", "clear", "fork":
		default:
			return ""
		}
		if !IsUUID(in.Psid) {
			return ""
		}
		head = `{"v":1,"ev":"SessionStart"`
	default:
		return ""
	}
	j := head + `,"id":"` + in.ID + `"`
	if IsUUID(in.Psid) {
		j += `,"sid":"` + in.Psid + `"`
	}
	if in.Event == "SessionStart" {
		j += `,"src":"` + in.Src + `"`
		if in.Src != "clear" && in.RegUUID != nil {
			if u := in.RegUUID(); IsUUID(u) {
				j += `,"reg":"` + u + `"`
			}
		}
	}
	if in.Event == "PostCompact" && (in.Trig == "manual" || in.Trig == "auto") {
		j += `,"trig":"` + in.Trig + `"`
	}
	if IsUUID(in.Gen) {
		j += `,"gen":"` + in.Gen + `"`
	}
	// The bash writes `ts` only when EPOCHREALTIME parses (a bash with no such clock writes none); a clock that is
	// not a positive epoch writes none here. D-TBD-go-hook-history-ts.
	if in.NowMs >= 1000 {
		j += `,"ts":` + strconv.FormatInt(in.NowMs, 10)
	}
	return j + "}"
}
