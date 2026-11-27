package attention

import (
	"strings"
	"unicode/utf8"

	"ccrc/core/internal/kernel/vocab"
)

// The history card line (ccd/session-hook.sh, `_hook_history_card`, spec 2026-10-05 §8.6): on a main-thread
// SessionStart(compact) whose PreCompact marked the compaction main, the sweep's one-line prediction for this transcript
// is folded above the compact card, on its own line, when it fits COMPACT_CARD_MAX_CHARS. The cap, grammar and
// directories are ccd/history/lib.mjs's, generated into vocab; the hook's own bash spells them once more, held equal by
// single-definition.test.ts.

// historyWS is the card's explicit blank set, ` \t\n\v\f\r` (never `[[:space:]]`, which a locale widens).
const historyWS = " \t\n\v\f\r"

// historyLine is CARD_LINE_PATTERN read whole: Go's `^` and `$` outside multi-line mode are the text's two ends, as
// bash's `=~` reads them.
var historyLine = re(vocab.CardLinePattern)

// HistoryIO is what the card reads, every path absolute.
type HistoryIO struct {
	Home     string
	Gen      string                       // CCRC_SESSION_GENERATION
	Exists   func(p string) bool          // `-e`
	IsLink   func(p string) bool          // `-L`
	IsDir    func(p string) bool          // `-d`
	Exec     func(p string) bool          // `-x`
	IsFile   func(p string) bool          // `-f`
	CtRead   func(p string) ([]byte, int) // `_ct_read`'s test and read: rc 0 the bytes, 1 absent, 2 no readable regular file
	Read     func(p string) ([]byte, bool)
	NowMs    int64
	Registry string // ~/.cc-sessions
}

// HistoryCard is `_hook_history_card`: compact with the card line folded in above it, or compact unchanged.
func HistoryCard(id, psid string, paid bool, compact string, io HistoryIO, utf bool) string {
	root := io.Home + "/" + vocab.HistoryRootRel
	if paid || io.Exists(io.Home+"/"+vocab.SwitchesOff) || Chars(id, utf) > SpoolIDMax || !IsUUID(psid) {
		return compact
	}
	if RecallWithheld(id, psid, io, utf) {
		return compact
	}
	b, rc := io.CtRead(root + "/" + vocab.ScopeDir + "/" + id)
	if rc != 0 {
		return compact
	}
	v, _ := ctRead(b, utf)
	ms, ok := strings.CutPrefix(v, "main "+psid+" ")
	if !ok || !scopeMs().MatchString(ms) {
		return compact
	}
	at := decimalWrap(ms)
	if io.NowMs < at || io.NowMs-at > vocab.ScopeMarkerMaxAgeMs {
		return compact
	}
	f := root + "/" + vocab.CardDir + "/" + id + "/" + psid + ".txt"
	if !io.IsFile(f) {
		return compact
	}
	line := ""
	if cb, ok := io.Read(f); ok {
		line = strings.TrimSuffix(readChars(cb, vocab.CardLineMax+1, utf), "\n")
	}
	if !historyLine().MatchString(line) || Chars(line, utf)+1+Chars(compact, utf) > CompactCardMaxChars {
		return compact
	}
	if compact == "" {
		return line
	}
	return line + "\n" + compact
}

// RecallWithheld is the card's generation and recall-off steps: true (rc 0 in the bash) when this session's recall is
// off or cannot be told. The steer print asks the same (`_hook_history_steer_recall_off`, the bash's parity-pinned
// second copy of these steps, which the Go hook does not need: one owner).
func RecallWithheld(id, psid string, io HistoryIO, utf bool) bool {
	root := io.Home + "/" + vocab.HistoryRootRel
	gen, via := "", ""
	g := io.Registry + "/" + id + ".generation"
	if IsUUID(io.Gen) {
		gen, via = io.Gen, "session"
	} else {
		b, rc := io.CtRead(g)
		if io.Exists(g) || io.IsLink(g) {
			raw := idMax // CT_RAWN stays CCRC_ID_MAX on a file `_ct_read` did not read
			if rc == 0 {
				_, raw = ctRead(b, utf)
			}
			x, nul := "", false
			if !io.IsLink(g) && raw < idMax {
				x, nul = nulProbe(io.Read(g))(idMax, utf)
			}
			if io.IsLink(g) || raw >= idMax || nul {
				via = "bad"
			} else if x = strings.Trim(x, historyWS); IsUUID(x) {
				gen, via = x, "registry"
			} else if x != "" {
				via = "bad"
			}
		}
	}
	off := root + "/" + vocab.RecallOffDir + "/" + id
	dir := root + "/" + vocab.RecallOffDir // `${off%/*}`: an id holds no slash
	if io.IsLink(off) || io.IsLink(dir) || io.Exists(dir) && !(io.IsDir(dir) && io.Exec(dir)) {
		return true
	}
	if io.Exists(off) {
		if !io.IsFile(off) {
			return true
		}
		b, ok := io.Read(off)
		if !ok {
			return true // `-r` fails
		}
		o := readChars(b, idMax, utf)
		if Chars(o, utf) >= idMax {
			return true
		}
		if o = strings.Trim(o, historyWS); strings.Trim(o, "0123456789abcdef-") != "" {
			return true
		}
		switch via {
		case "bad":
			return true
		case "":
			pg := root + "/" + vocab.CardDir + "/" + id + "/" + psid + ".gen"
			if io.IsLink(pg) {
				return true
			}
			if _, rc := io.CtRead(pg); rc != 0 {
				return true
			}
			x, nul := nulProbe(io.Read(pg))(idMax, utf)
			if nul {
				return true
			}
			if x = strings.Trim(x, historyWS); x != "" && !IsUUID(x) {
				return true
			}
			gen = x
		}
		if o == gen {
			return true
		}
	}
	return false
}

// scopeMsPattern is the marker's stamp as `_hook_history_card` spells it (`[[ "$ms" =~ ^…$ ]]`): the bash is its owner,
// and TestScopeMsPinned reds when the hook's spelling and this one part.
const scopeMsPattern = `[123456789][0123456789]{0,15}`

var scopeMs = re(`\A` + scopeMsPattern + `\z`)

// readChars is `IFS= read -r -N n v`: the first n characters (bytes in a C locale), NUL bytes dropped and not counted.
func readChars(b []byte, n int, utf bool) string {
	return Clip(strings.ReplaceAll(string(b), "\x00", ""), n, utf)
}

// nulProbe is `{ x=.; IFS= read -r -d ” -n n x < f; }` over what the open read (ok false: it could not be opened, x
// stays `.` and read fails): x, and whether read answered 0, which it does on stopping at a NUL or at the n-th character.
func nulProbe(b []byte, ok bool) func(n int, utf bool) (string, bool) {
	return func(n int, utf bool) (string, bool) {
		if !ok {
			return ".", false
		}
		count := 0
		for i := 0; i < len(b); {
			w := 1
			if utf {
				_, w = utf8.DecodeRune(b[i:])
			}
			if b[i] == 0 {
				return string(b[:i]), true
			}
			i += w
			if count++; count == n {
				return string(b[:i]), true
			}
		}
		return string(b), false
	}
}
