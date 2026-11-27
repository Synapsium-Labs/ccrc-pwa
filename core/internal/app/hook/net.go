package hook

import (
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ccrc/core/internal/domain/attention"
)

// The network and the door: tail stages 9, 17, 21 and 23 and the SessionStart arm's two reads (ccd/session-hook.sh, the
// start report and its loads, the door's reports and delta, the model reports, the roster card and its wake, the anchor).
// attention decides every outcome; this file reads, runs the closed client (`~/.local/bin/ccrc-api`, a process through the
// L3 adapter) and jq's three modules, and writes, in the bash's order.

// RunResult is one bounded process run (the adapter's answer, declared here by its consumer).
type RunResult struct {
	Out  []byte
	Rc   int
	Hung bool
}

// Sub is `$( )`: no NUL byte, no trailing newline.
func (r RunResult) Sub() string {
	return strings.TrimRight(strings.ReplaceAll(string(r.Out), "\x00", ""), "\n")
}

// api is `timeout <bound> ~/.local/bin/ccrc-api args…`.
func (h *run) api(bound time.Duration, stdin []byte, merge bool, extra []string, args ...string) RunResult {
	if !h.hasTimeout() {
		return RunResult{Rc: 127} // `_hook_timeout` with no `timeout` or `gtimeout` starts nothing
	}
	return h.Run(bound, stdin, extra, merge, h.client(), args...)
}

// client is the closed client, `~/.local/bin/ccrc-api` (`_hook_api`'s and the approval wait's `apr_api`).
func (h *run) client() string { return h.home + "/.local/bin/ccrc-api" }

// aprCall is `_apr_call`: the client with stderr merged, its answer's body and code, false for no answer. It runs
// unbounded and outside the invocation's net budget, as the bash's does: the approval wait is the one declared wait, its
// own window (at most APPROVAL_HOOK_WAIT_S, under the managed hook timeout) bounds it between calls, and it neither
// spends the budget nor reads or sets the hung latch.
func (h *run) aprCall(stdin []byte, args ...string) (body, code string, ok bool) {
	r := h.Run(0, stdin, nil, true, h.client(), args...)
	if r.Rc != 0 {
		return "", "", false
	}
	return attention.AprAnswer(r.Sub())
}

// bound is `_hook_net_bound`: the read's bound, and whether it is to start.
func (h *run) bound(max int64) (time.Duration, bool) {
	left, ok := h.net.Bound(h.NowMs(), max)
	return attention.Seconds(left), ok
}

// note records a read that ran out its bound.
func (h *run) note(r RunResult) {
	if r.Hung {
		h.net.Hung = true
	}
}

// hasTimeout is whether `_hook_timeout` has a binary to run its command under.
func (h *run) hasTimeout() bool { return attention.HasTimeout(h.Found) }

// ---------------------------------------------------------------------------------------------------- door reports

// doorReport is `_hook_door_report`: one send, any failure silent.
func (h *run) doorReport(body []byte) {
	d, ok := h.bound(attention.ReportTimeoutS * 1000)
	if !ok {
		return
	}
	h.note(h.api(d, append(append([]byte{}, body...), '\n'), false, nil, "sessions", "report", h.id, "--json", "-"))
}

// doorArms is `_hook_door_arms`, run at tail stage 17 for a session with a door that is not a child.
func (h *run) doorArms(ps attention.Parsed, c attention.Class, pre string, tmsub bool) {
	child := h.p(h.id + ".child")
	if !attention.DoorSession(h.Getenv("CCRC_DOOR_NONCE_SHA256")) || h.exists(child) || h.isLink(child) {
		return
	}
	tool := ""
	if ps.Event == "PreToolUse" {
		tool = c.Tool
	}
	for _, b := range attention.DoorReports(attention.DoorIn{V: ps.Payload, ID: h.id, Key: attention.DoorKey(tool, ps.Payload, attention.Denied(pre)),
		Aid: ps.Aid, Joined: tmsub, Quiet: !ps.Paid && c.Bg == "0", Now: h.NowMs()}) {
		h.doorReport(b)
	}
}

// modelReport is `_hook_model_report`: one model-switch report from a main-thread, non-child session with a registry row.
func (h *run) modelReport(how string, ps attention.Parsed) {
	child := h.p(h.id + ".child")
	if !attention.ModelReportOK(ps.Paid, h.id, h.isRegular(h.p(h.id+".generation")), h.exists(child), h.isLink(child)) {
		return
	}
	h.doorReport(attention.ModelReport(how, h.id, h.NowMs(), ps.Payload))
}

// doorDelta is `_hook_door_delta`: the cache's line, read under no network.
func (h *run) doorDelta() string {
	d := h.p(".door")
	f := filepath.Join(d, h.id, "delta")
	if h.isLink(d) || h.isLink(filepath.Join(d, h.id)) || h.isLink(f) || !h.isRegular(f) {
		return attention.DoorDeltaUnknown
	}
	raw, err := h.FS.ReadFile(f, 1024) // `_hook_timeout 2 head -c 1024`
	if err != nil || !h.hasTimeout() {
		return attention.DoorDeltaUnknown
	}
	return attention.DoorDelta(raw, h.NowMs())
}

// ---------------------------------------------------------------------------------------------------- the anchor

// rosterEligible is `_hook_roster_eligible`.
func (h *run) rosterEligible(ps attention.Parsed) bool {
	child := h.p(h.id + ".child")
	return attention.RosterEligible(ps.Paid, h.exists(filepath.Join(h.home, ".ccrc", "ccrc-card-off")), h.exists(child), h.isLink(child))
}

// anchorFetch is `_hook_anchor_fetch`: the door's word and text, and false when the budget did not start the read.
func (h *run) anchorFetch(form string, ps attention.Parsed) (word, text string, asked bool) {
	if !h.rosterEligible(ps) {
		return "", "", true
	}
	d, ok := h.bound(attention.AnchorBoundMs)
	if !ok {
		return "", "", false
	}
	r := h.api(d, nil, false, nil, "card", "--anchor", "--form", form)
	h.note(r)
	if r.Rc != 0 {
		return "", "", true
	}
	word, text = attention.AnchorAnswer(r.Sub(), form)
	return word, text, true
}

// anchorOwed is `_hook_anchor_owed`: at most one envelope, and the mark kept, counted or removed. It answers whether it
// printed.
func (h *run) anchorOwed(ps attention.Parsed, delta string) bool {
	m := h.p(h.id + ".anchor-owed")
	b, _ := h.FS.ReadFile(m, 0)
	tries := attention.OwedTries(firstLine(b))
	word, text, asked := h.anchorFetch("prompt", ps)
	if !asked {
		return false
	}
	pl := attention.Owed(word, tries)
	if pl.Print {
		h.out.Write(append(attention.PromptEnvelope(attention.WithDelta(text, attention.AnchorPromptMaxChars, delta, h.utf8)), '\n'))
		_ = h.FS.Remove(m)
		return true
	}
	if pl.Remove {
		_ = h.FS.Remove(m)
	} else if pl.Count != "" {
		_ = h.FS.WriteFile(m, []byte(pl.Count), 0o666)
		if !h.exists(h.p(h.id + ".generation")) {
			_ = h.FS.Remove(m)
		}
	}
	return false
}

// ---------------------------------------------------------------------------------------------------- the roster card

// rosterCard is `_hook_roster_card`: the card (armed) or "" with the shadow log appended (unarmed).
func (h *run) rosterCard(event string, ps attention.Parsed) string {
	if !h.rosterEligible(ps) {
		return ""
	}
	d, ok := h.bound(attention.AnchorBoundMs)
	if !ok {
		return ""
	}
	r := h.api(d, nil, false, nil, "runs", "list")
	h.note(r)
	if r.Rc != 0 {
		return ""
	}
	body := r.Sub()
	in := []byte(body + "\n")
	cr := h.Run(0, in, nil, false, "jq", "-L", h.lib(), "-r", "--arg", "me", h.id, "--argjson", "now", strconv.FormatInt(h.NowMs(), 10),
		"--argjson", "max", strconv.Itoa(attention.RosterCardMaxChars-64), `include "roster-card"; roster_card($me; $now; $max)`)
	card := cr.Sub()
	if cr.Rc != 0 || card == "" {
		return ""
	}
	if attention.RosterLive(body) {
		return card
	}
	log := filepath.Join(h.home, ".ccrc", "roster-card-shadow.log")
	var size int64
	st, err := h.FS.Lstat(log)
	if err == nil {
		size = st.Size()
	}
	if !attention.RosterShadowDue(err == nil, size) {
		return ""
	}
	_ = h.FS.MkdirAll(filepath.Dir(log), 0o777)
	_ = h.FS.AppendFile(log, []byte(attention.RosterShadowLine(h.NowMs(), h.id, event, card)))
	return ""
}

// rosterWake is `_hook_roster_wake`: at most one envelope carrying the card; it answers whether it printed.
func (h *run) rosterWake(ps attention.Parsed, payload, delta string) bool {
	if !h.rosterEligible(ps) {
		return false
	}
	tp := attention.WakePrompt(ps.Payload)
	if !attention.WakeReady(tp, h.isRegular(tp)) {
		return false
	}
	tail, terr := h.FS.ReadTail(tp, attention.RosterWakeTailBytes)
	if terr != nil { // `tail | jq` under pipefail, `|| return 0`
		return false
	}
	o := h.Run(0, tail, nil, false, "jq", "-L", h.lib(), "-rRs", `include "transcript"; idle_compaction_open`)
	if o.Rc != 0 || !attention.IdleOpen(o.Sub()) {
		return false
	}
	card := h.rosterCard("wake", ps)
	if card == "" {
		return false
	}
	h.out.Write(append(attention.PromptEnvelope(attention.WithDelta(card, attention.RosterCardMaxChars, delta, h.utf8)), '\n'))
	return true
}

// promptTail is tail stage 21: the door's delta, the roster wake, the owed anchor, then the delta's own envelope when
// neither of them printed one (one envelope an event).
func (h *run) promptTail(ps attention.Parsed, payload string) {
	delta := ""
	if attention.DoorSession(h.Getenv("CCRC_DOOR_NONCE_SHA256")) {
		delta = h.doorDelta()
	}
	woke, printed := false, false
	if attention.WakeFiltered(payload) {
		woke = h.rosterWake(ps, payload, delta)
	}
	if m := h.p(h.id + ".anchor-owed"); !woke && h.regular(m) {
		printed = h.anchorOwed(ps, delta)
	}
	if attention.DeltaAlone(delta, woke, printed) {
		h.out.Write(append(attention.PromptEnvelope(delta), '\n'))
	}
}
