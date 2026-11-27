package attention

import (
	"strconv"

	"ccrc/core/internal/kernel"
)

// Next is what the hookstate's next line is decided from (tail stages 10, 11, 14, 15 and 18): this event's parse and
// classification, the prefilter read, the run's stamp, and the reads the rules may ask for. The reads are the caller's
// (each is asked only where the bash asks it, and Fresh reads the file anew each time, as `_hook_fresh_read` does).
type Next struct {
	P              Parsed
	C              Class
	Prev           Prev
	Hts            string      // this run's stamp, "" when the turn marker took none
	SessionID, PID string      // CLAUDE_CODE_SESSION_ID and CLAUDE_PID as the environment holds them
	MainStateCap   func() bool // `_hook_server_cap hook-main-state-v1`
	LiveGateCap    func() bool // `_hook_server_cap dispatch-live-gate-v1`
	Fresh          func() Fresh
	NowMs          func() int64
	GdPlus         bool // the PreToolUse search gate denied this call: graphGateDenials counts it (`gd=$((gd + 1))`)
}

// NextHookstate is the write's inputs, or skip true where this run writes no hookstate (an agent event with no main
// state to carry, D-5232, or a compaction behind dispatch-live-gate-v1, D-5239).
func NextHookstate(n Next) (w Write, skip bool) {
	ev, c, p := n.P.Event, n.C, n.Prev
	cnt := Counters{Gq: p.Gq, Gd: p.Gd, Cp: p.Cp, Cc: p.Cc}
	subs, apl := p.Subs, p.Apl
	if ev == "SessionStart" {
		if c.Src != "resume" {
			cnt = Counters{Gq: "0", Gd: "0", Cp: "0", Cc: "0"}
		}
		subs, apl = "[]", "[]"
	}
	if ev == "Stop" && !n.P.Paid {
		subs = PruneSubagents(subs, c.Bg, c.Bgi, c.Bgd, c.Bgdk)
	}
	cnt = Count(cnt, c.Gcmd, n.P.Payload)
	if n.GdPlus {
		cnt.Gd = incText(cnt.Gd)
	}

	aid := n.P.Aid
	state, ask, interrupted := c.State, c.Ask, c.Interrupted
	askBad := c.AskBad // the ask is c's own, and several values made it two lines
	bgd, bgdk := c.Bgd, c.Bgdk
	waitby := ""
	if state == "waiting" && n.P.Paid {
		waitby = "subagent"
	}
	hms := n.P.Paid && n.MainStateCap()
	var fr Fresh
	fresh := func() { fr = n.Fresh() }
	wUpd, wEv, wAlive, wpOut := "", "", "", ""
	alive := func() string { return strconv.FormatInt(n.NowMs(), 10) }
	keepStamp := func() { // `_hook_keep_stamp`
		if fr.State == "waiting" && fr.By != "subagent" && digits.MatchString(fr.Upd) {
			wUpd, wEv, wAlive = fr.Upd, fr.Ev, alive()
		}
	}
	keepMainStamp := func() bool { // `_hook_keep_main_stamp`
		if fr.State == "" || !digits.MatchString(fr.Upd) {
			return false
		}
		wUpd, wEv, wAlive = fr.Upd, fr.Ev, alive()
		return true
	}
	askOf := func(s string) any { // `--argjson ask "${…:-null}"`
		v, _ := kernel.JQParse([]byte(s))
		return v
	}
	hcarry := false

	// The roster, keyed by agent_id (D-5232), and the subagent event's carry of the main state (D-4041).
	if ev == "SubagentStart" || ev == "SubagentStop" {
		name, rosterID := SubagentName(n.P.Payload)
		aid = rosterID // the roster's own id rule reassigns the id, as the bash's `read -r aid` does
		subs = Subagents(subs, ev, name, aid, n.NowMs())
		if p.State == "" {
			skip = true
		} else if fresh(); fr.State == "" {
			skip = true
		} else {
			state, ask, interrupted, waitby, askBad = fr.State, askOf(fr.Ask), fr.Int, fr.By, false
			if hms {
				keepMainStamp()
				if fr.By == "subagent" {
					if s, ok := fr.WaitPrevKept(); ok {
						wpOut = s
					}
				}
			} else {
				keepStamp()
			}
			bgd, bgdk = fr.Bgd, fr.Bgdk
		}
	}
	// A subagent's tool event never ends the main thread's wait (D-4039).
	if n.P.Paid && p.State == "waiting" && (ev == "PreToolUse" || ev == "PostToolUse") {
		fresh()
		if fr.State == "waiting" && fr.By != "subagent" {
			state, ask, interrupted, waitby, askBad = "waiting", askOf(fr.Ask), fr.Int, "", false
			keepStamp()
		}
	}
	// Behind the server's word, an agent tool event never rewrites the main state (D-5232).
	if hms && (ev == "PostToolUse" || ev == "PreToolUse" && c.Tool != "AskUserQuestion") && state != "waiting" {
		if p.State == "" {
			skip = true
		} else {
			if p.State != "waiting" {
				fresh()
			}
			switch {
			case fr.State == "":
				skip = true
			case fr.State == "waiting" && fr.By == "subagent":
				if fr.WpState != "" && digits.MatchString(fr.WpUpd) {
					state, ask, interrupted, waitby, hcarry, askBad = fr.WpState, askOf(fr.WpAsk), fr.WpInt, "", true, false
					wUpd, wEv, wAlive = fr.WpUpd, fr.WpEv, alive()
				}
			case keepMainStamp():
				state, ask, waitby, hcarry, interrupted, askBad = fr.State, askOf(fr.Ask), "", true, fr.Int, false
			}
			if hcarry && fr.Bgd != "" {
				bgd, bgdk = fr.Bgd, fr.Bgdk
			} else {
				bgd, bgdk = "", ""
			}
		}
	}
	// A subagent's own wait stores the main state it replaced (D-5232, D-5374).
	if hms && waitby == "subagent" && p.State != "" {
		if !(ev == "PreToolUse" && p.State == "waiting") {
			fresh()
		}
		if fr.State == "waiting" && fr.By == "subagent" {
			if s, ok := fr.WaitPrevKept(); ok {
				wpOut = s
			}
		} else if s := fr.WaitPrevOf(); s != "" {
			wpOut = s
		}
		if fr.Bgd != "" {
			hcarry, bgd, bgdk = true, fr.Bgd, fr.Bgdk
		}
	}
	// A working or done write clears the ask, unless it carries one; the delegated pair stands only on a main Stop or a
	// carry (D-5231).
	if (state == "working" || state == "done") && !(ev == "SubagentStart" || ev == "SubagentStop" || hcarry) {
		ask, askBad = nil, false
	}
	if !(ev == "Stop" || ev == "SubagentStart" || ev == "SubagentStop" || hcarry) {
		bgd, bgdk = "", ""
	}
	if (ev == "PreCompact" || ev == "PostCompact") && n.LiveGateCap() {
		skip = true
	}
	// The per-agent approval envelopes: this agent's entry for this call goes with its tool event, all of its entries
	// with its stop, and a subagent's PermissionRequest adds its own.
	apDrop, apCall := "", n.P.ApCall
	switch ev {
	case "PreToolUse", "PostToolUse", "PermissionRequest":
		apDrop = aid
	case "SubagentStop":
		apDrop, apCall = aid, ""
	}
	at := wUpd // `${w_upd:-${hts:-$(_hook_epoch_ms)}}`: one stamp per run (D-3616)
	if at == "" {
		at = n.Hts
	}
	late := at == "" // the bash takes the clock where it writes (`$(_hook_epoch_ms)` in the write's own jq call), after the door's sends
	var updatedAt int64
	if !late {
		updatedAt, _ = strconv.ParseInt(at, 10, 64)
	}
	event := ev
	if wEv != "" {
		event = wEv
	}
	return Write{State: state, Event: event, SessionID: n.SessionID, PID: n.PID, UpdatedAt: updatedAt, LateStamp: late,
		Interrupted: interrupted, Ask: ask, AskBad: askBad, Subs: subs, Apl: apl, Gq: cnt.Gq, Gd: cnt.Gd, Cp: cnt.Cp, Cc: cnt.Cc,
		WaitBy: waitby, AliveAt: wAlive, Bgd: bgd, Bgdk: bgdk, WaitPrev: wpOut, ApDrop: apDrop, ApCall: apCall,
		ApAdd: ev == "PermissionRequest" && c.Apr && aid != ""}, skip
}
