package attention

import (
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

// The W3 steer print and its receipt (ccd/session-hook.sh `_hook_history_pre`, spec 2026-10-05 §7.2, §7.7), and the
// role's compaction text that opens the print (`_hook_role_compact_text`, Overlord W1a C51).

// SteerIn is what the print's gates read, in their order.
type SteerIn struct {
	Paid, Refused bool
	Off, SteerOff bool        // ~/.ccrc/history-off, history-steer-off
	Withheld      func() bool // RecallWithheld
	ID, Psid      string
	SteerOn       bool // `steer-on/<id>` a regular file, never a link
	Scope         func() string
	Read          func() (text, leaf string, ok bool) // SteerRead over the steer file
	UTF8          bool
}

// Steer is the gates in the bash's order; ok false prints nothing.
func Steer(in SteerIn) (text, leaf string, ok bool) {
	if in.Paid || in.Refused || in.Off || in.SteerOff || in.Withheld() {
		return "", "", false
	}
	if Chars(in.ID, in.UTF8) > 224 || !IsUUID(in.Psid) || !in.SteerOn || in.Scope() != "main" {
		return "", "", false
	}
	return in.Read()
}

// SteerFile is how the steer file stands, as `_hook_history_steer_read` tests it (LC_ALL=C).
type SteerFile struct {
	Link         bool   // the steer directory, the session's directory or the file is a link
	DirBad       bool   // a directory that exists but is not a searchable directory
	Absent       bool   // no file: the generic variant
	ReadableFile bool   // `-f && -r`
	Bytes        []byte // its content (when ReadableFile), at most 8,193 bytes
}

var leafRE = re(`\AL[0123456789abcdef]{20}\z`)

// SteerRead is gate 6: the generic variant for an absent file; else a regular, readable file of at most 8,192 bytes
// holding no NUL, not starting with `{`, whose first line is the template's (`read -r -d ” -n 8193` answering end of
// file), with one trailing LF cut, and its leaf id when it names one.
func SteerRead(f SteerFile) (text, leaf string, ok bool) {
	if f.Link || f.DirBad {
		return "", "", false
	}
	if f.Absent {
		return vocab.SteerGenericText, "", true
	}
	t := f.Bytes
	if !f.ReadableFile || len(t) > 8192 || strings.IndexByte(string(t), 0) >= 0 {
		return "", "", false
	}
	s := string(t)
	if strings.HasPrefix(s, "{") {
		return "", "", false
	}
	if first, _, _ := strings.Cut(s, "\n"); first != vocab.SteerFirstLine {
		return "", "", false
	}
	text = strings.TrimSuffix(s, "\n")
	if _, rest, found := strings.Cut(text, "\n<ccrc-leaf id=\""); found {
		if id, _, _ := strings.Cut(rest, `"`); leafRE().MatchString(id) {
			leaf = id
		}
	}
	return text, leaf, true
}

// SteerPrint is the one print: the role's compaction section first when there is one, then the steer text.
func SteerPrint(role, text string) string {
	head := ""
	if role != "" {
		head = "\nccrc-role-compaction: " + role + "\n"
	}
	return head + "\n" + text + "\n"
}

// SteerReceipt is the receipt's spool line (built by hand in the bash: every value already sanitised). gen is
// CCRC_SESSION_GENERATION; ts the clock read once (written only as a positive integer).
func SteerReceipt(id, psid, leaf, gen string, ts int64) string {
	j := `{"v":1,"ev":"steer","id":"` + id + `","sid":"` + psid + `","leaf":"` + leaf + `"`
	if IsUUID(gen) {
		j += `,"gen":"` + gen + `"`
	}
	if s := strconv.FormatInt(ts, 10); receiptTsRE().MatchString(s) {
		j += `,"ts":` + s
	}
	return j + "}"
}

var (
	receiptTsRE   = re(`\A[123456789][0123456789]{0,14}\z`)
	profileRE     = re(`\A[a-z]{1,16}\z`)
	windowRE      = re(`\A[1-9][0-9]{5,6}\z`)
	compactTextRE = re(`\A[ -~]{1,600}\z`)
	untypeableRE  = re(`["'$;\\` + "`" + `]`)
)

// RoleCompactProfile is the route's gate: `read -r -n 17 p < profile; read -r -n 8 w < compactwindow`, a profile name
// of 1 to 16 lowercase letters and a window of 100,000 to 1,000,000. ok false: no section.
func RoleCompactProfile(profile, window []byte) (string, bool) {
	p, w := readN(profile, 17), readN(window, 8)
	if !profileRE().MatchString(p) || !windowRE().MatchString(w) {
		return "", false
	}
	n, _ := bashInt(w)
	return p, n >= 100000 && n <= 1000000
}

// RoleCompactText is COMPACT_TEXT_JQ over launch-profiles.json (`jq -r --arg r <profile>`, `|| HR_TEXT=""`): the
// profile's compactText when it is one typeable line of at most 600 characters holding none of `"'$;\` and the backtick;
// "" otherwise, or on any error.
func RoleCompactText(file []byte, profile string) string {
	vs, err := kernel.JQParseAll(file)
	if err != nil {
		return ""
	}
	var out []string
	for _, v := range vs {
		e, err := index(v, profile)
		if err != nil {
			return ""
		}
		t, err := index(e, "compactText")
		if err != nil {
			return ""
		}
		s, ok := t.(string)
		if !ok || !compactTextRE().MatchString(s) || untypeableRE().MatchString(s) {
			return ""
		}
		out = append(out, s)
	}
	return cmdSubst(strings.Join(out, "\n"))
}
