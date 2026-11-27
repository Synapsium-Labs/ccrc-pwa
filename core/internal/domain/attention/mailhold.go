package attention

import (
	"path/filepath"
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
)

// The mail hold (`_hook_mail_hold`, mid-turn mail spec 2026-11-19 §3.5): the marker's read and its lease, the strip, and
// the module `ccd/lib/mail-hold.jq`, which stays a jq process (wave 2 inventory §4, "keep"): its matcher, its texts and
// the shadow log's decision are its own, so the hook here only reads, strips and asks it. MailHold decides what the bash
// decides around the module; L4 runs the two jq processes and writes what it answers.

// MailHoldIn is what the bash's function reads before any file.
type MailHoldIn struct {
	Event, Tool, Payload, ID string
	V                        any  // the payload as jq reads it
	Tmsub                    bool // a joined subagent
	NowSec                   int64
	UTF8                     bool
}

// MailHoldIO is what it asks for, each only where the bash asks.
type MailHoldIO struct {
	Marker   func() ([]byte, bool) // `[[ -f $REG/<id>.mailhold && ! -L … ]]` and its bytes
	Disabled func() bool           // `[[ -e $REG/mail-disabled ]]`
	Seen     func() ([]byte, bool) // `[[ -f <seen> && ! -L <seen> ]]` and its bytes
	Module   func() bool           // `[[ -f $ROSTER_CARD_LIB/mail-hold.jq ]]`
	Armed    func() string         // the arming words: "notice" ($REG/mailhold-notice-live), then ",refuse" ($REG/mailhold-refuse-live)
	// Prep is `jq -L lib -c 'include "mail-hold"; mh_prep'` over the payload: the payload the module's mh_prep made, or
	// false where that jq failed. The strip (MergeStrip) then runs here, the hook's own call composed of the two.
	Prep func() (any, bool)
	// Call is `jq -L lib -j --arg … 'include "mail-hold"; mail_hold($ARGS.named)'` over the payload, its args in order: the
	// raw stdout ("" where jq failed), and false where jq was never asked because its args could not be handed over
	// (Windows hands each in a temporary file; the bash needs no disk for them).
	Call func(args [][2]string) (string, bool)
	// LogSize is the shadow log's size as `find "$log" -size` reads it: the name itself (lstat), never a link's target.
	LogSize func() (int64, bool)
}

// MailHoldOut is what the bash does after it: the envelope (a deny or a notice, "" for none), and the writes.
type MailHoldOut struct {
	Pre    string
	Seen   string // the seen file's new text ("" leaves it)
	Log    string // the lines to append to the shadow log ("": nothing is written, the seen file included)
	Rotate bool   // the log is moved to `.1` before the append: `find "$log" -size +1024k` found it
}

const mailHoldReach = 360 // MAILHOLD_REACH_S

var mailHoldMarker = re(`\A([123456789][0123456789]{0,10}):((coordinator|overlord)\.[123456789][0123456789]{0,9})(,(coordinator|overlord)\.[123456789][0123456789]{0,9}){0,7}\z`)

// MailHold is the function. It runs on a PreToolUse (after the deny arms, while no deny is built) and on a Stop.
func MailHold(in MailHoldIn, io MailHoldIO) MailHoldOut {
	var out MailHoldOut
	m := false
	var raw []byte
	if b, ok := io.Marker(); ok {
		m, raw = true, b
	}
	cmd := in.Payload
	if i := strings.Index(cmd, `"command":"`); i >= 0 {
		cmd = cmd[i+len(`"command":"`):]
	}
	if i := strings.Index(cmd, `","`); i >= 0 {
		cmd = cmd[:i]
	}
	k := in.Tmsub && in.Event == "PreToolUse" && in.Tool == "Bash" && strings.Contains(cmd, "mail") &&
		(strings.Contains(cmd, "ack") || strings.Contains(cmd, "inbox"))
	if !(m || k) || io.Disabled() {
		return out
	}
	v := ""
	if m {
		v = Clip(nulCut(string(raw)), 256, in.UTF8) // `read -r -d '' -n 256`: to the first NUL, 256 characters
	}
	now := strconv.FormatInt(in.NowSec, 10)
	p, dl, st := "", "-", ""
	if mm := mailHoldMarker().FindStringSubmatch(v); mm != nil {
		_, p, _ = strings.Cut(v, ":")
		first, _, _ := strings.Cut(p, ",")
		_, dl, _ = strings.Cut(first, ".")
		until, _ := strconv.ParseInt(mm[1], 10, 64)
		switch {
		case until <= in.NowSec:
			st = "lapsed"
		case until > in.NowSec+mailHoldReach:
			st = "far"
		default:
			st = "live"
		}
	}
	tab := func(f ...string) string { return strings.Join(f, "\t") + "\n" }
	var o, t, l, s string
	switch {
	case in.Event == "Stop":
		l = tab(now, in.ID, "stop", "-", dl, "-")
	case st != "" || k:
		ran, strip := "", ""
		if st != "" && in.Tool == "Bash" && (strings.Contains(cmd, "push") || strings.Contains(cmd, "commit") || strings.Contains(cmd, "merge") ||
			strings.Contains(cmd, "pull") || strings.Contains(cmd, "rebase")) {
			ran = "1"
			if pv, ok := io.Prep(); ok {
				if r, ok := MergeStrip(pv); ok {
					strip = cmdSubst(r + "\n")
				}
			}
		}
		if st != "live" && ran == "" && !k {
			return out
		}
		seen := ""
		if b, ok := io.Seen(); ok {
			seen = Clip(nulCut(string(b)), 4096, in.UTF8)
		}
		ack := ""
		if k {
			ack = "1"
		}
		thread := ""
		if in.Tmsub {
			thread = "sub"
		}
		if io.Module() {
			armed := io.Armed()
			args := [][2]string{{"strip", strip}, {"ran", ran}, {"cap", strconv.Itoa(MergeParseCap)}, {"thread", thread}, {"pairs", p},
				{"state", st}, {"armed", armed}, {"sid", in.ID}, {"now", now}, {"seen", seen}, {"ack", ack}}
			r, asked := io.Call(args)
			if !asked {
				return mailHoldUnasked(armed, st, ran, k)
			}
			o, t, l, s = readFields(r)
		} else if first, _, _ := strings.Cut(seen, "\n"); first != p || !strings.Contains("\n"+seen, "\nmodule-missing\n") {
			if !(seen != "" && first == p) {
				seen = p + "\n"
			}
			s = seen + "module-missing\n"
			l = tab(now, in.ID, "-", "module-missing", dl, "-")
		}
	}
	switch o {
	case "deny":
		out.Pre = DenyJSON(t)
	case "notice":
		out.Pre = NudgeJSON(t)
	}
	if l != "" {
		out.Seen, out.Log = s, l
		// `-size +1024k`: more than 1024 blocks of 1 KiB, the size rounded up to whole blocks
		if n, ok := io.LogSize(); ok && (n+1023)/1024 > 1024 {
			out.Rotate = true
		}
	}
	return out
}

// mailHoldNoTempText is the refusal where the module could not be asked.
const mailHoldNoTempText = "ccrc: this act is held: the mail hold could not hand its check to jq (the temporary directory cannot be written), so it refuses rather than let the act through unchecked. Free space for the temporary directory, then retry."

// mailHoldUnasked is the hold when the module could not be asked (fix round 2, re-review N2): it never fails open. It
// refuses wherever the module could have refused: the refuse lane armed, and a live hold over a command that names a
// gated act's word, or a joined subagent's mail ack. That is stricter than the module (it refuses before reading the
// act's grammar), never looser. Nothing is logged and the seen file is left: there is no module answer to record.
func mailHoldUnasked(armed, st, ran string, k bool) MailHoldOut {
	var out MailHoldOut
	refuse := false
	for _, w := range strings.Split(armed, ",") {
		refuse = refuse || w == "refuse"
	}
	if refuse && ((st == "live" && ran == "1") || k) {
		out.Pre = DenyJSON(mailHoldNoTempText)
	}
	return out
}

func nulCut(s string) string {
	if i := strings.IndexByte(s, 0); i >= 0 {
		return s[:i]
	}
	return s
}

// readFields is `IFS=$'\x1f' read -r -d ” o t l s`: to the first NUL, three fields cut at the separator, the rest to the
// last, less one separator that ends it when it holds no other (measured in bash 5).
func readFields(out string) (o, t, l, s string) {
	out = nulCut(out)
	f := strings.SplitN(out, "\x1f", 4)
	for len(f) < 4 {
		f = append(f, "")
	}
	rest := f[3]
	if strings.HasSuffix(rest, "\x1f") && strings.Count(rest, "\x1f") == 1 {
		rest = rest[:len(rest)-1]
	}
	return f[0], f[1], f[2], rest
}

// MailHoldPrep reads the prepped payload jq printed (`-c`): its first value, as the strip's jq reads its input.
func MailHoldPrep(out []byte) (any, bool) {
	v, err := kernel.JQParseFirst(out)
	return v, err == nil
}

// RosterCardLib is ROSTER_CARD_LIB: the lib/ beside the program when it holds roster-card.jq (the bash's own
// directory's lib/; for the core, the lib/ beside it), else ~/.cc-sessions/lib.
func RosterCardLib(besideHasCard bool, beside, home string) string {
	if beside != "" && besideHasCard {
		return beside
	}
	return filepath.Join(home, ".cc-sessions", "lib")
}
