package hook

import (
	"path/filepath"
	"strconv"
	"time"

	"ccrc/core/internal/domain/attention"
	"ccrc/core/internal/kernel/vocab"
)

// state is tail stages 10 to 20: the hookstate read, the next line (decided by attention.NextHookstate), the write, and
// the PreToolUse print after it.
func (h *run) state(ps attention.Parsed, c attention.Class, hts, payload string, tmsub bool) {
	f := h.p(h.id + ".hookstate.json")
	var data []byte
	isFile := false
	if st, err := h.FS.Stat(f); err == nil && st.Mode().IsRegular() {
		isFile = true
		data, _ = h.FS.ReadFile(f, 0)
	}
	prev := attention.ReadPrev(data, isFile)
	// Tail stage 12, the PreToolUse arms, runs over what stage 10 read and builds the envelope the write is followed by:
	// the graph gate and nudge, the landing advisory, the role-skill deny, Fable, the test route, the reader arms and the
	// fan-out pin are Task 4's; the merge, account and child denies and the mail hold (stage 13) are Task 5's.
	pre, gdPlus := "", false
	if ps.Event == "PreToolUse" {
		o := h.preTool(ps, c, payload, prev, tmsub)
		pre, gdPlus = o.Json, o.GdPlus
	}
	// Tail stage 13, the mail hold: after the last deny arm, while no deny is built (on a Stop it only logs).
	if (ps.Event == "PreToolUse" || ps.Event == "Stop") && !attention.Denied(pre) {
		if j := h.mailHold(ps, c, payload, tmsub); j != "" {
			pre = j
		}
	}
	w, skip := attention.NextHookstate(attention.Next{P: ps, C: c, Prev: prev, Hts: hts, GdPlus: gdPlus,
		SessionID: h.Getenv("CLAUDE_CODE_SESSION_ID"), PID: h.Getenv("CLAUDE_PID"),
		MainStateCap: func() bool { return h.serverCap("hook-main-state-v1") },
		LiveGateCap:  func() bool { return h.serverCap("dispatch-live-gate-v1") },
		Fresh:        func() attention.Fresh { b, _ := h.FS.ReadFile(f, 0); return attention.ReadFresh(b) },
		NowMs:        h.NowMs})
	// Tail stage 16, the approval gate: its route word is the envelope's ask.approval.route.
	apr := ps.Event == "PermissionRequest" && c.Apr
	var gate attention.AprGate
	if apr {
		gate = h.approvalGate(payload)
		w.Route = gate.Route
	}
	h.doorArms(ps, c, pre, tmsub)
	if w.LateStamp { // the bash's clock is read where it writes, after the door's sends
		w.UpdatedAt = h.NowMs()
	}
	var line []byte // what the write stored (`$out`), nil when it wrote none
	if !skip {
		var ok bool
		if line, ok = attention.BuildHookstate(w, h.utf8); !ok {
			return // the bash's `|| exit 0`: no write, and no print after it (a deny is lost with the state, kept)
		}
		if !h.writeState(f, line) {
			return
		}
	}
	if pre != "" {
		h.out.WriteString(pre + "\n")
	}
	if ps.Event == "UserPromptSubmit" {
		h.promptTail(ps, payload)
	}
	if apr {
		h.approvalWait(ps, gate, line, w.UpdatedAt) // tail stage 22; `ap_at` is the write's own stamp
	}
	h.startLoads(ps, payload)
	h.compactTail(ps) // tail stages 24 and 25
}

// D-TBD-go-hook-argjson-stderr: on an `--argjson` bash cannot parse the bash's hookstate jq leaks its usage error to stderr, and
// this stays silent (status, stdout and files are the same).
// writeState replaces the hookstate file with line and its newline, through `$REG/.<id>.<pid>.hookstate.tmp` and a rename
// (the write, the route patch and the drop alike); false, with nothing left behind, where either step fails.
func (h *run) writeState(f string, line []byte) bool {
	tmp := h.p("." + h.id + "." + strconv.Itoa(h.Pid) + ".hookstate.tmp")
	if h.FS.WriteFile(tmp, append(line, '\n'), 0o666) != nil || h.FS.Rename(tmp, f) != nil {
		_ = h.FS.Remove(tmp)
		return false
	}
	return true
}

// serverCap is `_hook_server_cap <word>`: ~/.ccrc/server-caps read whole, the clock in seconds.
func (h *run) serverCap(word string) bool {
	b, err := h.FS.ReadFile(filepath.Join(h.home, ".ccrc", vocab.ServerCapsFile), 64*1024)
	if err != nil {
		return false
	}
	return attention.ServerCap(b, time.UnixMilli(h.NowMs()).Unix(), word)
}
