package attention

import (
	"bytes"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ccrc/core/internal/kernel"
)

// The graph measurement (ccd/session-hook.sh): `_hook_graph_measure`, its linked-tree reads (`_hook_graph_meta`,
// `_hook_load_graph_settings`), `_hook_graph_diff` and `_hook_gate_tree`, which the SessionStart card and the PreToolUse
// search gate both ask (D-1613: one measurement, two readers). The decisions are here; every read is the caller's, passed in
// as a func value and asked only where the bash asks it, in the bash's order (so a git stand-in on PATH sees the same
// calls in either implementation).

// GraphMax are the real directory's gate bounds (GRAPH_GATE_MAX_BEHIND, GRAPH_GATE_MAX_DENIALS) and the card's diff-list
// character bound (CARD_DIFF_LIST_MAX_CHARS = CARD_MAX_CHARS - 903 - 1107).
const (
	GraphGateMaxBehind  = 10
	GraphGateMaxDenials = 3
	cardDiffListMax     = 2400 - 903 - 1107
)

// GraphIO is what the measurement observes.
type GraphIO struct {
	Home    string
	UTF8    bool                                            // bash's `${#x}` counts code points (UTF-8 locale) or bytes
	Workdir func() string                                   // `cat $REG/<id>.workdir`, raw: "" when it cannot be read
	IsDir   func(p string) bool                             // `[ -d p ]`
	IsLink  func(p string) bool                             // `[ -L p ]`
	IsFile  func(p string) bool                             // `[ -f p ]`
	Head    func(p string, n int) []byte                    // `head -c n p`: nil when p cannot be read
	Tail    func(p string, n int) []byte                    // `tail -c n p`
	Git     func(dir string, args ...string) (string, bool) // `git -C dir args…` as `$( )` keeps it, and whether it exited 0
	NowSec  func() int64
}

// Graph is the measurement's globals (GM_*, and the linked tree's settings).
type Graph struct {
	CWD, Built, Nodes, Engine, Pin, Fresh, Behind string
	Linked                                        bool
	Files, Ref, Age, Store                        string
	Diff, Branch, MainMoved, DiffList             string
	MaxDenials                                    string // GM_MAX_DENIALS: a number as text, the card prints it
	MaxDiffPct                                    string // GS_MAX_DIFF_PCT
	DiffListMax                                   string // GS_DIFF_LIST_MAX
}

// MeasureGraph is `_hook_graph_measure`: its return code is three-valued, never collapsed: 0 a graph is there and was
// measured (Built may still be empty), 1 the tree resolved and carries no graphify-out/graph.json, 2 no tree at all.
func MeasureGraph(payload any, io GraphIO) (g Graph, rc int) {
	g.MaxDenials = strconv.Itoa(GraphGateMaxDenials)
	cwd := ""
	if c := get(payload, "cwd"); truthy(c) { // `jq -r '.cwd // empty'`
		cwd = cmdSub(rawOut(c))
	}
	if cwd == "" {
		cwd = cmdSub(io.Workdir())
	}
	if cwd == "" || !io.IsDir(cwd) {
		return g, 2
	}
	g.CWD = cwd
	out := cwd + "/graphify-out"
	if io.IsLink(out) && g.meta(cwd, io) {
		g.Linked = true
	} else {
		if !io.IsFile(out + "/graph.json") {
			return g, 1
		}
		g.Built = lastStamp(io.Tail(out+"/graph.json", 4096))
		g.Nodes = firstNodes(io.Head(out+"/GRAPH_REPORT.md", 4096))
		g.Engine = trimSpaces(io.Head(out+"/.graphify_engine", 64))
	}
	g.Pin = trimSpaces(io.Head(io.Home+"/.ccrc/graphify.pin", 64))

	// Staleness is measured or it is not claimed: a tree with no git, or a rev-list that will not answer, says no
	// freshness rather than a "fresh" nobody checked. Behind is set only where Fresh is a distance.
	tip, _ := io.Git(cwd, "rev-parse", "HEAD")
	if g.Built != "" && tip != "" {
		switch {
		case tip == g.Built:
			g.Fresh, g.Behind = "fresh", "0"
		case sameTree(io, cwd, g.Built):
			// D-1368: still `fresh`; the qualifier is appended only when the graph was built at ANOTHER commit.
			g.Fresh, g.Behind = "fresh", "0"
			if bc, _ := io.Git(cwd, "rev-parse", "--verify", "-q", g.Built+"^{commit}"); bc != tip {
				g.Fresh += " — same content as HEAD"
			}
		default:
			lr, _ := io.Git(cwd, "rev-list", "--left-right", "--count", g.Built+"...HEAD")
			// The pair is matched WHOLE: anything but two counts is the unmeasured answer (D-1336).
			m := countPair.FindStringSubmatch(lr)
			if m == nil {
				g.Fresh = "freshness unmeasured"
				break
			}
			ahead, behind := m[1], m[2]
			switch {
			case numTest(ahead, ">", 0):
				g.Fresh = "not an ancestor of HEAD"
			case numTest(behind, "==", 0):
				g.Fresh, g.Behind = "fresh", "0"
			case numTest(behind, "==", 1):
				g.Fresh, g.Behind = "1 commit behind HEAD", behind
			default:
				g.Fresh, g.Behind = behind+" commits behind HEAD", behind
			}
		}
	}
	if g.Linked {
		g.diff(cwd, io)
	}
	return g, 0
}

var (
	countPair  = regexp.MustCompile(`^([0-9]+)[ \t\n\v\f\r]+([0-9]+)$`)
	stampRE    = regexp.MustCompile(`"built_at_commit"[ \t\n\v\f\r]*:[ \t\n\v\f\r]*"[0-9a-f]+"`)
	nodesRE    = regexp.MustCompile(`[0-9]+ nodes`)
	hexSha     = regexp.MustCompile(`^[0-9a-f]{7,40}$`)
	hex40      = regexp.MustCompile(`^[0-9a-f]{40}$`)
	smallInt   = regexp.MustCompile(`^(0|[1-9][0-9]{0,11})$`)
	refName    = regexp.MustCompile(`^refs/[A-Za-z0-9._/-]{1,200}$`)
	ageText    = regexp.MustCompile(`^-?[0-9]{1,12}$`)
	pctText    = regexp.MustCompile(`^(0|[1-9][0-9]?|100)$`)
	countText  = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})$`)
	isoStamp   = regexp.MustCompile(`^([0-9]{1,4})-([0-9]{1,2})-([0-9]{1,2})T([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2})Z$`)
	digitsOnly = regexp.MustCompile(`^[0-9]+$`)
)

// cmdSub is what `$( … )` keeps: no NUL byte, no trailing newline. (Bash also warns on stderr that it dropped a NUL byte; this
// does not: D-TBD-go-hook-nul-warning-stderr. Stderr is no one's input and the decision, the files and stdout are the same.)
func cmdSub(s string) string { return strings.TrimRight(strings.ReplaceAll(s, "\x00", ""), "\n") }

// trimSpaces is `head -c n f | tr -d '[:space:]'` captured by `$( )`: tr is bytewise, so the six ASCII blanks go.
func trimSpaces(b []byte) string {
	var o bytes.Buffer
	for _, c := range b {
		if c != ' ' && !(c >= 9 && c <= 13) {
			o.WriteByte(c)
		}
	}
	return cmdSub(o.String())
}

// grepO is `grep -oE`'s answer over data: every match of re, in order, and whether grep called the input binary. Only a NUL
// byte does (measured on GNU grep 3.11 under a UTF-8 and the C locale: a byte that is not valid UTF-8 never does, on the matching
// line or any other, since only the matched bytes are checked); grep then prints "binary file matches" and no match, which no
// caller's shape test accepts, wherever the NUL stood in the window.
func grepO(data []byte, re *regexp.Regexp) (matches []string, binary bool) {
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, true
	}
	for _, line := range bytes.Split(data, []byte("\n")) {
		for _, m := range re.FindAll(line, -1) {
			matches = append(matches, string(m))
		}
	}
	return matches, false
}

// lastStamp is `tail -c 4096 graph.json | grep -oE '"built_at_commit"…"[0-9a-f]+"' | tail -n1`, then `${B#*:}`, the quotes
// and blanks cut, and the 7-to-40 hex test: the last stamp's sha, or "". The key holds no colon, so the first colon of the
// match ends it; only a space is cut, so a tab beside the sha leaves a word the hex test refuses.
func lastStamp(tail []byte) string {
	ms, bin := grepO(tail, stampRE)
	if bin || len(ms) == 0 {
		return ""
	}
	s := ms[len(ms)-1]
	s = s[strings.IndexByte(s, ':')+1:]
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\"", ""), " ", "")
	if !hexSha.MatchString(s) {
		return ""
	}
	return s
}

// firstNodes is `head -c 4096 GRAPH_REPORT.md | grep -oE '[0-9]+ nodes' | head -n1`, `${N% nodes}` and the digits test.
func firstNodes(head []byte) string {
	ms, bin := grepO(head, nodesRE)
	if bin || len(ms) == 0 {
		return ""
	}
	n := strings.TrimSuffix(ms[0], " nodes")
	if !digitsOnly.MatchString(n) {
		return ""
	}
	return n
}

// sameTree is `_hook_same_tree`: built's tree is HEAD's. Either side answering empty is not a match (D-1368).
func sameTree(io GraphIO, tree, built string) bool {
	bt, _ := io.Git(tree, "rev-parse", "--verify", "-q", built+"^{tree}")
	ht, _ := io.Git(tree, "rev-parse", "--verify", "-q", "HEAD^{tree}")
	return bt != "" && ht != "" && bt == ht
}

// numTest is bash's `[ "$a" -op N ]` for a decimal word and an integer: false when the word is no integer of 64 bits (the
// bash's `[` errors, which an `if` reads as false).
func numTest(a, op string, n int64) bool {
	x, err := strconv.ParseInt(a, 10, 64)
	if err != nil {
		return false
	}
	switch op {
	case ">":
		return x > n
	case "==":
		return x == n
	case "<":
		return x < n
	case "<=":
		return x <= n
	}
	return false
}

// meta is `_hook_graph_meta`: meta.json is read under `head -c 8192`, one jq program over it, every field shape checked
// before it is spent; false (and Built emptied) when the commit is not 40 hex, which measures the tree the old way. The
// fields are assigned BEFORE the commit test, as the bash's `read` does, so a failed meta leaves them in the globals.
//
// jq reads meta.json as a stream of values; this reads exactly one (D-TBD-go-hook-meta-single-value): a file holding a second value
// is a jq success there and a refusal here, which falls to the old arm. ccd writes one object.
func (g *Graph) meta(tree string, io GraphIO) bool {
	v, err := kernel.JQParse(io.Head(tree+"/graphify-out/meta.json", 8192))
	if err != nil { // a truncated, empty or unreadable file is a jq failure: `|| return 1`
		return false
	}
	var f []string
	switch s, err := index(v, "schema"); { // `select(.schema == 1)`: an error on a non-object is a failure too
	case err != nil:
		return false
	case equal(s, 1.0):
		f = []string{metaText(get(v, "commit")), metaText(get(v, "engine")), metaText(get(v, "nodes")), metaText(get(v, "files")),
			metaText(get(v, "ref")), metaAge(get(v, "built_at"), io.NowSec()), metaText(get(v, "store"))}
	default: // nothing printed: `read` leaves every field empty
		f = make([]string, 7)
	}
	g.Built, g.Engine, g.Nodes, g.Files, g.Ref, g.Age, g.Store = f[0], f[1], f[2], f[3], f[4], f[5], f[6]
	if !hex40.MatchString(g.Built) {
		g.Built = ""
		return false
	}
	g.Engine = keep(Clip(g.Engine, 64, io.UTF8), func(r rune) bool { return !glibcSpace(r, io.UTF8) })
	if !smallInt.MatchString(g.Nodes) {
		g.Nodes = ""
	}
	if !smallInt.MatchString(g.Files) {
		g.Files = ""
	}
	if !refName.MatchString(g.Ref) {
		g.Ref = ""
	}
	if !ageText.MatchString(g.Age) {
		g.Age = ""
	}
	if strings.HasPrefix(g.Age, "-") {
		g.Age = "0"
	}
	if !strings.HasPrefix(g.Store, "/") {
		g.Store = ""
	}
	g.settings(io)
	return true
}

// metaText is `if . == null then "" else tostring | gsub("[\u0000-\u001f]"; "") end`.
func metaText(v any) string {
	if v == nil {
		return ""
	}
	return keep(tostring(v), func(r rune) bool { return r > 0x1f })
}

// metaAge is `try ((now - (.built_at | fromdateiso8601)) | floor) catch ""`: the seconds since the stamp, as jq prints the
// number, or "" for anything that is not an ISO stamp of the shape strptime reads (D-TBD-go-hook-meta-age-shortcut; the age only
// reaches the SessionStart card, Task 8's, never a gate decision). shortcut: the stamp's fields are read
// as one to four digits (year) and one or two (the rest), the shape glibc's `%Y-%m-%dT%H:%M:%SZ` accepts without its
// padding and blank leniencies; ccd writes the canonical form.
func metaAge(v any, now int64) string {
	s, ok := v.(string)
	if !ok {
		return ""
	}
	m := isoStamp.FindStringSubmatch(s)
	if m == nil {
		return ""
	}
	n := make([]int, 6)
	for i := range n {
		n[i], _ = strconv.Atoi(m[i+1])
	}
	if n[1] < 1 || n[1] > 12 || n[2] < 1 || n[2] > 31 || n[3] > 23 || n[4] > 59 || n[5] > 61 {
		return ""
	}
	t := time.Date(n[0], time.Month(n[1]), n[2], n[3], n[4], n[5], 0, time.UTC).Unix()
	return kernel.JQDouble(math.Floor(float64(now - t)))
}

// glibcSpace is `[[:space:]]` as bash's pattern substitution reads it: ASCII in a C locale, and under UTF-8 glibc's set
// (which holds U+0085 and U+00A0 never, nor the no-break spaces U+2007 and U+202F).
func glibcSpace(r rune, utf bool) bool {
	if r == ' ' || r >= 9 && r <= 13 {
		return true
	}
	return utf && (r == 0x1680 || r >= 0x2000 && r <= 0x2006 || r >= 0x2008 && r <= 0x200a || r == 0x2028 || r == 0x2029 || r == 0x205f || r == 0x3000)
}

// settings is `_hook_load_graph_settings`: the store's settings.json under `head -c 4096`, `select(.schema == 1)`; a key
// that is not its shape keeps its default (the knobs ccd/ccrc's `_graph_knobs` carries: a test holds them equal).
func (g *Graph) settings(io GraphIO) {
	g.MaxDiffPct, g.MaxDenials, g.DiffListMax = "25", "3", "20"
	if g.Store == "" {
		return
	}
	v, err := kernel.JQParse(io.Head(g.Store+"/settings.json", 4096))
	if err != nil {
		return
	}
	if s, err := index(v, "schema"); err != nil || !equal(s, 1.0) {
		return
	}
	ws := []string{}
	for _, k := range []string{"gate_max_diff_pct", "gate_max_denials", "card_diff_list_max"} {
		ws = append(ws, tostring(get(v, k)))
	}
	// `read -r a b c <<<"a b c"`: the first line, split at blanks, the last name taking the rest
	line, _, _ := strings.Cut(strings.Join(ws, " "), "\n")
	f := readWords(line, 3)
	if pctText.MatchString(f[0]) {
		g.MaxDiffPct = f[0]
	}
	if countText.MatchString(f[1]) {
		g.MaxDenials = f[1]
	}
	if countText.MatchString(f[2]) {
		g.DiffListMax = f[2]
	}
}

// readWords is `read -r a b c` over one line with the default IFS: leading blanks dropped, a word each, the last name
// taking what is left less its trailing blanks.
func readWords(line string, n int) []string {
	out := make([]string, n)
	rest := strings.TrimLeft(line, " \t")
	for i := 0; i < n-1; i++ {
		j := strings.IndexAny(rest, " \t")
		if j < 0 {
			out[i], rest = rest, ""
			break
		}
		out[i], rest = rest[:j], strings.TrimLeft(rest[j:], " \t")
	}
	if rest != "" {
		out[n-1] = strings.TrimRight(rest, " \t")
	}
	return out
}

// diff is `_hook_graph_diff`: GM_DIFF counts the files differing between the graph's commit and HEAD, GM_BRANCH the share
// that are the branch's own (changed since merge-base), GM_DIFF_LIST names up to the settings' bound of them, the branch's
// own FIRST, and stops at the first name that would pass the card's character bound (it stops rather than skipping to a
// shorter one, so the order holds); GM_MAIN_MOVED is what main gained since the refresh. A git that will not answer leaves
// its value empty.
func (g *Graph) diff(tree string, io GraphIO) {
	all, ok := io.Git(tree, "diff", "--no-renames", "--name-only", g.Built, "HEAD")
	if !ok {
		return
	}
	mb, ok := io.Git(tree, "merge-base", g.Built, "HEAD")
	if !ok {
		mb = ""
	}
	br := ""
	if mb != "" {
		if br, ok = io.Git(tree, "diff", "--no-renames", "--name-only", mb, "HEAD"); !ok {
			br = ""
		}
	}
	own := map[string]bool{}
	for _, f := range strings.Split(br, "\n") {
		if f != "" {
			own[f] = true
		}
	}
	var first, rest []string
	for _, f := range strings.Split(all, "\n") {
		switch {
		case f == "":
		case own[f]:
			first = append(first, f)
		default:
			rest = append(rest, f)
		}
	}
	g.Branch = strconv.Itoa(len(first))
	total := len(first) + len(rest)
	g.Diff = strconv.Itoa(total)
	size := func(s string) int { return Chars(s, io.UTF8) }
	listMax, _ := strconv.Atoi(g.DiffListMax)
	n := 0
	for _, f := range append(first, rest...) {
		if n >= listMax || size(g.DiffList)+2+size(f) > cardDiffListMax {
			break
		}
		if g.DiffList != "" {
			g.DiffList += ", "
		}
		g.DiffList += f
		n++
	}
	if total > n {
		if g.DiffList != "" {
			g.DiffList += " and "
		}
		g.DiffList += strconv.Itoa(total-n) + " more"
	}
	if g.Ref != "" {
		if mm, ok := io.Git(tree, "rev-list", "--count", g.Built+".."+g.Ref); ok {
			g.MainMoved = mm
		}
	}
	if !digitsOnly.MatchString(g.MainMoved) {
		g.MainMoved = ""
	}
}

// GateTree is `_hook_gate_tree`: the measured tree carries a graph fresh enough to gate on. A linked tree is gated by
// SHARE (the files differing from the graph's commit are at most the store's bound of the graph's files, and the graph's
// engine is the pin); a real directory by the commits it is behind.
func (g Graph) GateTree() bool {
	if g.Linked {
		d, e1 := strconv.ParseInt(g.Diff, 10, 64)
		f, e2 := strconv.ParseInt(g.Files, 10, 64)
		p, e3 := strconv.ParseInt(g.MaxDiffPct, 10, 64)
		return g.Diff != "" && g.Files != "" && g.Pin != "" && g.Engine == g.Pin && e1 == nil && e2 == nil && e3 == nil && d*100 <= p*f
	}
	return g.Behind != "" && numTest(g.Behind, "<=", GraphGateMaxBehind)
}
