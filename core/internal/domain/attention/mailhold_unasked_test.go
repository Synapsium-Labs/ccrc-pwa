package attention

import "testing"

// The mail hold never fails open when its module could not be asked (fix round 2, re-review N2): on Windows each --arg
// value goes to jq in a temporary file, and the bash needs no disk for them. So where jq was never asked, the hold refuses
// wherever the module could have refused, and answers as before where it could not.
func TestMailHoldRefusesWhenTheModuleCannotBeAsked(t *testing.T) {
	cases := []struct {
		name, armed, marker, cmd string
		sub, asked               bool
		deny                     bool
	}{
		{"a live hold over a push, refuse armed", ",refuse", "1100:coordinator.7", "git push", false, false, true},
		{"both lanes armed", "notice,refuse", "1100:coordinator.7", "git commit -m x", false, false, true},
		{"a joined subagent's mail ack, refuse armed", ",refuse", "", "ccrc-api mail ack 3", true, false, true},
		{"notice only: the module would not refuse", "notice", "1100:coordinator.7", "git push", false, false, false},
		{"nothing armed (shadow)", "", "1100:coordinator.7", "git push", false, false, false},
		{"a lapsed hold: the module would not refuse", ",refuse", "900:coordinator.7", "git push", false, false, false},
		{"no gated word in the command", ",refuse", "1100:coordinator.7", "ls", false, false, false},
		{"asked, and jq failed: the bash's empty answer", ",refuse", "1100:coordinator.7", "git push", false, true, false},
	}
	for _, c := range cases {
		marker := c.marker
		io := MailHoldIO{
			Marker:   func() ([]byte, bool) { return []byte(marker), marker != "" },
			Disabled: func() bool { return false },
			Seen:     func() ([]byte, bool) { return nil, false },
			Module:   func() bool { return true },
			Armed:    func() string { return c.armed },
			Prep:     func() (any, bool) { return nil, false },
			Call:     func([][2]string) (string, bool) { return "", c.asked },
			LogSize:  func() (int64, bool) { return 0, false },
		}
		in := MailHoldIn{Event: "PreToolUse", Tool: "Bash", Payload: `{"tool_input":{"command":"` + c.cmd + `","x":1}}`, ID: "lane-a-project-a",
			Tmsub: c.sub, NowSec: 1000}
		out := MailHold(in, io)
		if got := out.Pre == DenyJSON(mailHoldNoTempText); got != c.deny {
			t.Errorf("%s: deny %v, want %v (pre %q)", c.name, got, c.deny, out.Pre)
		}
		if c.deny && (out.Log != "" || out.Seen != "") {
			t.Errorf("%s: an unasked module leaves the log and the seen file (log %q, seen %q)", c.name, out.Log, out.Seen)
		}
	}
}
