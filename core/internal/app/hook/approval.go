package hook

import (
	"path/filepath"
	"strconv"

	"ccrc/core/internal/domain/attention"
)

// The approval gate (tail stage 16) and the approval wait (tail stage 22) of ccd/session-hook.sh, for a PermissionRequest
// that set `apr`. attention decides every word, window and envelope; this file reads, runs the closed client and the
// verifier, sleeps the ticks and writes, in the bash's order.

// approvalGate is `_hook_approval_gate`: the route word the hookstate write stores, and on `sent` the request.
func (h *run) approvalGate(payload string) attention.AprGate {
	regNoLink := func(name string) ([]byte, bool) {
		if !h.regular(h.p(name)) {
			return nil, false
		}
		b, err := h.FS.ReadFile(h.p(name), 0)
		return b, err == nil
	}
	return attention.ApprovalGate(payload, h.id, h.home, h.utf8, attention.AprReads{
		Child:    func() bool { return h.exists(h.p(h.id + ".child")) },
		Disabled: func() bool { return h.exists(h.p("approvals-disabled")) },
		Stamp:    func() ([]byte, int) { return h.ctRead(h.id + ".deny-settings") },
		UUID:     func() ([]byte, int) { return h.ctRead(h.id + ".uuid") },
		Managed:  func() ([]byte, bool) { return regNoLink("child-deny.settings.json") },
		History:  func() ([]byte, bool) { return regNoLink("child-deny.digests") },
		Found:    h.Found,
		Verifier: func() bool { return h.isRegular(h.p("approval-verify.mjs")) },
		Key:      func() bool { return h.isRegular(filepath.Join(h.home, ".ccrc", "approval-signing.pub")) },
		Client:   func() bool { return h.FS.Executable(h.client()) },
		Nonce:    h.Nonce,
	})
}

// approvalWait is `_hook_approval_wait`, after the hookstate write: line is the line the write stored (nil when it wrote
// none) and at its stamp (`ap_at`). It asks for a ruling, then waits for at most the request's window, each tick watching
// the transcript for the pane's answer and every poll-th tick reading the ruling; it prints at most one envelope.
func (h *run) approvalWait(ps attention.Parsed, g attention.AprGate, line []byte, at int64) {
	if g.Route != "sent" {
		return // every pre-send gate ran above the write; only `sent` goes on
	}
	tick := attention.AprTick(h.Getenv("CCRC_APPROVAL_TICK_S"))
	poll := attention.AprPoll(h.Getenv("CCRC_APPROVAL_POLL_TICKS"))
	ceil := attention.AprCeil(h.Getenv("CCRC_APPROVAL_CEILING_S"))
	h.Trap()
	body, code, ok := h.aprCall(append(append([]byte{}, g.Body...), '\n'), "approvals", "request", "--json", "-")
	if !ok {
		h.routePatch("request-failed", line, ps.Aid, at)
		return
	}
	if code != "201" {
		h.routePatch(attention.AprRefused(body, code), line, ps.Aid, at)
		return
	}
	rid, waits, park, ok := attention.AprGranted(body)
	if !ok {
		h.routePatch("request-failed", line, ps.Aid, at)
		return
	}
	deadline := h.NowMs() + attention.AprWindowMs(ceil, waits)
	w := attention.AprWatch{TP: attention.AprTranscript(ps.Payload, ps.Paid, ps.Aid, ps.Psid), TI: g.TI, Seen: -1}
	ends := func(b []byte) {
		h.out.Write(append(b, '\n'))
		h.approvalsDrop(ps.Aid, at, line)
	}
	for t := 0; ; t++ {
		if h.NowMs() >= deadline {
			if park == "live" {
				ends(attention.AprParkDeny(rid))
			}
			return
		}
		if w.Look(h.transcript(w.TP)) {
			h.approvalsDrop(ps.Aid, at, line)
			return
		}
		if t%poll == 0 {
			if body, code, ok := h.aprCall(nil, "approvals", "ruling", rid, "--nonce", g.Nonce); ok {
				switch code {
				case "200":
					r := attention.AprRuled(body)
					if r.Stop {
						return
					}
					if r.Parked {
						ends(attention.AprParkDeny(rid))
						return
					}
					if r.J != "" {
						v := h.Run(0, []byte(r.J+"\n"), nil, false, "node", h.p("approval-verify.mjs"),
							h.id, ps.Aid, g.Digest, g.Nonce, rid, strconv.FormatInt(h.NowMs(), 10))
						verdict := ""
						if v.Rc == 0 {
							verdict = v.Sub()
						}
						if env, end := attention.AprVerdict(verdict, g.Dd); end {
							if env != nil {
								h.out.Write(append(env, '\n'))
							}
							return
						}
					}
				case "404", "410":
					return
				}
			}
		}
		h.Sleep(tick)
	}
}

// transcript is the watch's reads of the request's transcript.
func (h *run) transcript(tp string) attention.TranscriptReads {
	return attention.TranscriptReads{
		Size: func() (int64, bool) {
			st, err := h.FS.Lstat(tp)
			if err != nil || !st.Mode().IsRegular() {
				return 0, false
			}
			return st.Size(), true
		},
		Last: func() ([]byte, bool) { b, err := h.FS.ReadTail(tp, 1); return b, err == nil },
		Range: func(off, n int64) ([]byte, bool) {
			b, err := h.FS.ReadRange(tp, off, n)
			return b, err == nil
		},
	}
}

// routePatch is `_hook_approval_route_patch <word>`: only over this run's own line, still standing in the file.
func (h *run) routePatch(word string, line []byte, aid string, at int64) {
	f := h.p(h.id + ".hookstate.json")
	if len(line) == 0 || !h.regular(f) {
		return
	}
	cur, _ := h.FS.ReadFile(f, 0) // an unreadable file reads as "", which is not the line
	if nl, ok := attention.RoutePatch(cur, line, word, aid, at); ok {
		h.writeState(f, nl)
	}
}

// approvalsDrop is `_hook_approvals_drop`: this agent's entry stamped at, from the file as it stands now. A run that
// wrote no hookstate (line nil, the bash's `hs_skip`) drops nothing.
func (h *run) approvalsDrop(aid string, at int64, line []byte) {
	f := h.p(h.id + ".hookstate.json")
	if aid == "" || len(line) == 0 || !h.regular(f) {
		return
	}
	b, err := h.FS.ReadFile(f, 0)
	if err != nil {
		return
	}
	if nl, ok := attention.ApprovalsDrop(b, aid, at); ok {
		h.writeState(f, nl)
	}
}
