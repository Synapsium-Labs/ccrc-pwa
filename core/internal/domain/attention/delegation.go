package attention

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

// The delegation spool and the launch record (ccd/session-hook.sh: `DSP_DEFS`'s `spool` and `lrec`, `_hook_spool_*`,
// `_hook_launch_record_append`). Pure: the facts the bash reads from files arrive as arguments or func values.

// The launch record's budget (`LRC_MAX_BYTES`, `LRC_DROP_RESERVE`): only a drop row may use the reserve past the cap.
const (
	LRCMaxBytes    = 1048576
	LRCDropReserve = 4096
)

var (
	uuidRE   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	verRE    = regexp.MustCompile(`^[0-9][0-9A-Za-z.+-]{0,31}$`)
	bucketRE = regexp.MustCompile(`^[0-9]{10}$`)
	listName = regexp.MustCompile(`^[A-Za-z0-9._@+-]+$`)
)

// IsUUID is the lowercase 8-4-4-4-12 shape every gate here tests.
func IsUUID(s string) bool { return uuidRE.MatchString(s) }

// LineBelow is `DSP_LINE_BELOW`: 4096 only where bash's stdout buffer is glibc's st_blksize, which bash tests twice: OSTYPE
// says linux-gnu AND its own build's machine type (BASH_VERSINFO[5]) says Linux GNU; else 1008, so a line is one write(2)
// wherever the hook runs. ostype is the environment's OSTYPE and set says it is in the environment at all (bash keeps an
// imported one, an empty one too). The second test cannot be asked of a Go program, so it is goos == "linux" and not musl
// (the caller says musl from the box's loaders): an exported OSTYPE=linux-gnu on darwin or Windows is 1008, as in bash.
func LineBelow(goos, ostype string, set, musl bool) int {
	if !set {
		ostype = "linux-gnu"
	}
	if goos == "linux" && !musl && strings.HasPrefix(ostype, "linux-gnu") {
		return vocab.DelegationSpoolBoundsLineBytesBelow
	}
	return vocab.DelegationSpoolBoundsLineBytesBelowSmall
}

// Gate is what the spool's gate decides before the parse: whether the spool line and the launch row are built, and the
// values the parse is handed.
type Gate struct {
	Gen     string // dsp_gen: the incarnation the line carries ("" = a gate refused: nothing is built)
	Ver     string // dsp_ver
	Wrapper string // lrc_w
	Spool   bool   // build the spool line (dsp_sp and a delegation event in the payload)
	Lrec    bool   // build the launch row
	Below   int
}

// GateIn is what the bash's builtins observe.
type GateIn struct {
	ID         string
	GenRaw     string // the first 37 characters of `<id>.generation`, read only when it is a regular file ("" otherwise)
	EnvGen     string // CCRC_SESSION_GENERATION
	SpoolDirOK bool   // the owner's spool directory is a directory, not a link, and neither are its two parents
	DelegOK    bool   // `.deleg` is absent or a regular file (a dangling link reads as absent, as `-e` does)
	Payload    string
	ExecPath   string // CLAUDE_CODE_EXECPATH
	Below      int
	WrapperRaw func() string // the first 65 bytes of `<id>.wrapper`, read only when it is a regular file
}

var gateWords = []string{`"Bash"`, `"Agent"`, `"Task"`, `"Workflow"`, `"SessionStart"`, `"SessionEnd"`, `"SubagentStart"`,
	`"SubagentStop"`, `task-notification>`, `"SendMessage"`}

func containsAny(s string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

// GateDecide is the statement above the parse: a sound incarnation must exist, and the spool's text is built only for a
// payload that carries the quoted name of a delegation tool or event or the notification tag (a necessary condition).
func GateDecide(in GateIn) Gate {
	g := Gate{Below: in.Below}
	if strings.HasPrefix(in.ID, ".") || len(in.ID) > vocab.HookConstantsCcrcIdMax || !IsUUID(in.GenRaw) ||
		(in.EnvGen != "" && in.EnvGen != in.GenRaw) {
		return g
	}
	if !containsAny(in.Payload, gateWords...) {
		return g
	}
	ver := in.ExecPath[strings.LastIndex(in.ExecPath, "/")+1:]
	if !verRE.MatchString(ver) {
		ver = ""
	}
	g.Gen, g.Ver = in.GenRaw, ver
	lrcC := in.SpoolDirOK
	if !lrcC && in.DelegOK && strings.Contains(in.Payload, `"PostToolUse"`) &&
		containsAny(in.Payload, `"Agent"`, `"Task"`, `"Workflow"`, `"SendMessage"`) {
		lrcC = true
	}
	if !lrcC {
		return g
	}
	g.Spool = in.SpoolDirOK
	if g.Lrec = in.DelegOK; g.Lrec {
		w := strings.TrimSuffix(in.WrapperRaw(), "\n")
		g.Wrapper = w
	}
	return g
}

// SpoolOut is the parse's lines 6 to 9: the hour bucket, the prune cutoff bucket, the listing's cwd and the line.
type SpoolOut struct{ Bucket, Cut, Cwd, Line string }

func objOf(v any) kernel.Obj {
	if o, ok := v.(kernel.Obj); ok {
		return o
	}
	return kernel.Obj{}
}

func str(v any) (string, bool) { s, ok := v.(string); return s, ok }

// fits is `fits($m)`: a string within $m code points and $m bytes.
func fits(s string, m int) bool { return utf8.RuneCountInString(s) <= m && len(s) <= m }

// chk is `chk($m)`: [value, over]: a string that fits is itself, a string that does not is dropped and counted, and
// anything else is absent.
func chk(v any, m int) (any, bool) {
	s, ok := str(v)
	switch {
	case !ok:
		return nil, false
	case fits(s, m):
		return s, false
	}
	return nil, true
}

// req is `req($m)`: a non-empty string that fits, or null.
func req(v any, m int) any {
	if s, ok := str(v); ok && s != "" && fits(s, m) {
		return s
	}
	return nil
}

func over(v any, m int) bool { s, ok := str(v); return ok && !fits(s, m) }

// outcome is the `outcome` def: a tool response's status as the closed word.
func outcome(v any) string {
	switch s, _ := str(v); s {
	case "async_launched":
		return "async-launched"
	case "completed":
		return "completed"
	case "failed", "error":
		return "failed"
	}
	return "unknown"
}

func idOrNil(v any) any {
	if isID(v) {
		return v
	}
	return nil
}

func isWord(s string) bool {
	n := utf8.RuneCountInString(s)
	return n >= 1 && n <= 32 && keep(s, func(r rune) bool { return r >= 'a' && r <= 'z' || r == '_' || r == '-' }) == s
}

// tagv is `tagv($o; $c)`: the text between an opening and a closing tag the string starts and ends with.
func tagv(v any, o, c string) any {
	s, ok := str(v)
	if !ok || !strings.HasPrefix(s, o) || !strings.HasSuffix(s, c) {
		return nil
	}
	if len(s) < len(o)+len(c) {
		return ""
	}
	return s[len(o) : len(s)-len(c)]
}

// note is the `note` def: a syntactically valid task notification (ids and status read from the block's header lines).
func note(v any) any {
	s, ok := str(v)
	if !ok || !strings.HasPrefix(s, "<task-notification>\n") || !strings.Contains(s, "</task-notification>") {
		return nil
	}
	l := strings.Split(strings.TrimPrefix(s, "<task-notification>\n"), "\n")
	at := func(i int) any {
		if i < len(l) {
			return l[i]
		}
		return nil
	}
	a, b := tagv(at(0), "<task-id>", "</task-id>"), tagv(at(1), "<tool-use-id>", "</tool-use-id>")
	i := 2
	if l2, ok := at(2).(string); ok && strings.HasPrefix(l2, "<output-file>") {
		i = 3
	}
	d, _ := tagv(at(i), "<status>", "</status>").(string)
	if !isID(a) || !isID(b) || !isWord(d) {
		return nil
	}
	st := "unknown"
	switch d {
	case "completed":
		st = "completed"
	case "failed":
		st = "failed"
	case "killed", "cancelled", "canceled", "stopped":
		st = "cancelled"
	}
	return kernel.Obj{{K: "taskId", V: a}, {K: "toolUseId", V: b}, {K: "status", V: st}}
}

// SpoolIn is what the parse is handed with `--arg`: the owner's id, its generation, the version and the cap, the clock.
type SpoolIn struct {
	ID, Gen, Ver string
	Below        int
	NowMs        int64
}

func stamp(ms int64) (s int64, t string) {
	s = ms / 1000
	return s, time.Unix(s, 0).UTC().Format("2006-01-02T15:04:05") + fmt.Sprintf(".%03dZ", ms%1000)
}

// SpoolLine is `def spool`: one bounded, closed-field evidence line for the event (never a prompt, result or tool
// input), shed in a fixed order to fit the cap. An event that writes no line answers four empty strings.
func SpoolLine(ps Parsed, in SpoolIn) SpoolOut {
	p := ps.Payload
	ev := ps.Event
	tn, _ := str(get(p, "tool_name"))
	tu := idOrNil(get(p, "tool_use_id"))
	cs := idOrNil(get(p, "session_id"))
	hasa := ps.Paid
	aid := ps.Aid
	at, ato := chk(get(p, "agent_type"), vocab.DelegationSpoolBoundsLabelBytes)
	cwd, cwdo := chk(get(p, "cwd"), vocab.DelegationSpoolBoundsPathBytes)
	tp, tpo := chk(get(p, "transcript_path"), vocab.DelegationSpoolBoundsPathBytes)
	ti := objOf(get(p, "tool_input"))
	r := get(p, "tool_response")
	o := objOf(r)
	oc := outcome(get(o, "status"))
	cmd, _ := str(get(ti, "command"))
	wt := strings.Contains(cmd, "worktree")
	label, path := vocab.DelegationSpoolBoundsLabelBytes, vocab.DelegationSpoolBoundsPathBytes

	var b kernel.Obj
	var vo, vw, ok bool
	switch {
	case ev == "SessionStart":
		if s := req(get(p, "source"), label); s != nil {
			b, ok = kernel.Obj{{K: "source", V: s}}, true
		}
	case ev == "SessionEnd":
		if s := req(get(p, "reason"), label); s != nil {
			b, ok = kernel.Obj{{K: "reason", V: s}}, true
		}
	case ev == "SubagentStart":
		if aid != "" {
			b, ok = kernel.Obj{}, true
		}
	case ev == "SubagentStop":
		if aid != "" {
			ap, apo := chk(get(p, "agent_transcript_path"), path)
			b, vo, ok = kernel.Obj{{K: "agentTranscriptPath", V: ap}}, apo, true
		}
	case ev == "UserPromptSubmit":
		if n := note(get(p, "prompt")); n != nil {
			b, ok = kernel.Obj{{K: "notification", V: n}}, true
		}
	case ev == "PreToolUse" && tu != nil:
		switch tn {
		case "Agent", "Task", "Workflow":
			iso, isoo := chk(get(ti, "isolation"), label)
			b, vo, ok = kernel.Obj{{K: "toolName", V: tn}, {K: "toolUseId", V: tu}, {K: "isolation", V: iso}}, isoo, true
		case "Bash":
			b, vw, ok = kernel.Obj{{K: "toolName", V: "Bash"}, {K: "toolUseId", V: tu}}, wt, true
		}
	case ev == "PostToolUse" && tu != nil:
		switch tn {
		case "Agent", "Task":
			var launch any
			if (oc == "async-launched" || oc == "completed") && isID(get(o, "agentId")) {
				async := oc == "async-launched"
				if bv, isB := get(o, "isAsync").(bool); isB {
					async = bv
				}
				launch = kernel.Obj{{K: "status", V: oc}, {K: "agentId", V: get(o, "agentId")}, {K: "isAsync", V: async}}
			}
			b, ok = kernel.Obj{{K: "toolName", V: tn}, {K: "toolUseId", V: tu}, {K: "outcome", V: oc}, {K: "launch", V: launch}}, true
		case "Workflow":
			tt, wn := req(get(o, "taskType"), label), req(get(o, "workflowName"), label)
			td, sp := req(get(o, "transcriptDir"), path), req(get(o, "scriptPath"), path)
			var launch any
			if (oc == "async-launched" || oc == "completed") && isID(get(o, "taskId")) && isID(get(o, "runId")) &&
				tt != nil && wn != nil && td != nil && sp != nil {
				launch = kernel.Obj{{K: "status", V: oc}, {K: "taskId", V: get(o, "taskId")}, {K: "taskType", V: tt},
					{K: "workflowName", V: wn}, {K: "runId", V: get(o, "runId")}, {K: "transcriptDir", V: td}, {K: "scriptPath", V: sp}}
			}
			b, ok = kernel.Obj{{K: "toolName", V: "Workflow"}, {K: "toolUseId", V: tu}, {K: "outcome", V: oc}, {K: "launch", V: launch}}, true
			vo = over(get(o, "taskType"), label) || over(get(o, "workflowName"), label) ||
				over(get(o, "transcriptDir"), path) || over(get(o, "scriptPath"), path)
		case "Bash":
			out := "unknown"
			if ro, isObj := r.(kernel.Obj); isObj {
				if equal(get(ro, "interrupted"), true) {
					out = "failed"
				} else if _, isStr := str(get(ro, "stdout")); isStr {
					out = "completed"
				}
			}
			b, vw, ok = kernel.Obj{{K: "toolName", V: "Bash"}, {K: "toolUseId", V: tu}, {K: "outcome", V: out}}, wt, true
		}
	}
	if cs == nil || !(!hasa || aid != "") || !ok {
		return SpoolOut{}
	}
	ov := cwdo || tpo || ato || vo
	cwdS, _ := cwd.(string)
	trig := vw && cwd != nil && strings.HasPrefix(cwdS, "/") && keep(cwdS, func(r rune) bool { return r >= 32 && r != 127 }) == cwdS
	rs := 0
	if trig {
		rs = 17
	}
	s, t := stamp(in.NowMs)
	line := func(n int) kernel.Obj {
		l := kernel.Obj{{K: "v", V: 1}, {K: "eventKind", V: ev}, {K: "observedAt", V: t}, {K: "sessionId", V: in.ID},
			{K: "parentIncarnation", V: in.Gen}, {K: "claudeSessionId", V: cs}}
		if in.Ver != "" && n < 1 {
			l = append(l, kernel.KV{K: "claudeVersion", V: in.Ver})
		}
		if cwd != nil && n < 2 {
			l = append(l, kernel.KV{K: "cwd", V: cwd})
		}
		if aid != "" {
			l = append(l, kernel.KV{K: "agentId", V: aid})
		}
		if ev == "SubagentStart" || ev == "SubagentStop" {
			var a any
			if n < 3 {
				a = at
			}
			l = append(l, kernel.KV{K: "agentType", V: a})
		} else if aid != "" && at != nil && n < 3 {
			l = append(l, kernel.KV{K: "agentType", V: at})
		}
		if tp != nil && n < 4 {
			l = append(l, kernel.KV{K: "transcriptPath", V: tp})
		}
		for _, kv := range b {
			l = set(l, kv.K, kv.V)
		}
		if n > 0 || ov {
			l = set(l, "truncated", true)
		}
		return l
	}
	for n := 0; n < 5; n++ {
		j := kernel.JQCompact(line(n))
		if len(j)+1+rs < in.Below {
			cw := ""
			if trig {
				cw = cwdS
			}
			return SpoolOut{Bucket: time.Unix(s, 0).UTC().Format("2006010215"), Cut: time.Unix(s-86400, 0).UTC().Format("2006010215"),
				Cwd: strings.Trim(cw, " \t"), Line: string(j)}
		}
	}
	return SpoolOut{}
}

func lrwc(r rune) bool {
	return r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r == '.' || r == '-' || r == '_'
}

func lrbyte(r rune) bool { return lrwc(r) || r == '/' || r == '@' || r == '+' }

func lrdrop(t int64, why string) string {
	return string(kernel.JQCompact(kernel.Obj{{K: "v", V: 1}, {K: "t", V: t}, {K: "k", V: "drop"}, {K: "why", V: why}}))
}

// lrpath is `lrpath($tp; $cs)`: the Workflow script path, kept only when it sits under its own session's
// `workflows/scripts/` directory in the closed alphabet; otherwise null.
func lrpath(v, tpv any, cs string) any {
	s, ok := str(v)
	tp, ok2 := str(tpv)
	if !ok || !ok2 || !strings.HasPrefix(tp, "/") || !strings.HasSuffix(tp, "/"+cs+".jsonl") {
		return nil
	}
	pre := tp[:len(tp)-6] + "/workflows/scripts/"
	if !fits(s, vocab.DelegationSpoolBoundsPathBytes) || !strings.HasPrefix(s, pre) || !strings.HasSuffix(s, ".js") ||
		keep(s, lrbyte) != s {
		return nil
	}
	for _, seg := range strings.Split(s, "/")[1:] {
		if seg == "" || seg == "." || seg == ".." {
			return nil
		}
	}
	if len(s) < len(pre)+3 {
		return nil
	}
	name := s[len(pre) : len(s)-3]
	if len(name) < 1 || len(name) > 128 || !idch(rune(name[0])) || keep(name[1:], lrwc) != name[1:] {
		return nil
	}
	return s
}

// LaunchRow is `def lrec`: the launch record's row for a background launch (Workflow, a resume, Agent or Task, a
// SendMessage to an agent id), a `drop` row saying why one was lost, a drop row then a row (one TAB between), or "".
func LaunchRow(ps Parsed, in SpoolIn, wrapper string) string {
	p := ps.Payload
	if ps.Event != "PostToolUse" {
		return ""
	}
	tn, _ := str(get(p, "tool_name"))
	ti := objOf(get(p, "tool_input"))
	o := objOf(get(p, "tool_response"))
	oc := outcome(get(o, "status"))
	cs := idOrNil(get(p, "session_id"))
	t := in.NowMs
	var w any
	if wrapper != "" && utf8.RuneCountInString(wrapper) <= 64 && keep(wrapper, lrwc) == wrapper {
		w = wrapper
	}
	rr := get(ti, "resumeFromRunId")
	var k string
	var ids []any
	var b kernel.Obj
	ws, shape := false, false
	switch tn {
	case "Workflow":
		switch {
		case rr != nil && oc != "async-launched":
			shape = true
		case oc != "async-launched":
			return ""
		case rr != nil:
			k, ids, b, ws = "resume", []any{rr, get(o, "taskId")}, kernel.Obj{{K: "run", V: rr}, {K: "task", V: get(o, "taskId")}}, true
		default:
			k, ids, b, ws = "workflow", []any{get(o, "runId"), get(o, "taskId")}, kernel.Obj{{K: "run", V: get(o, "runId")}, {K: "task", V: get(o, "taskId")}}, true
		}
	case "Agent", "Task":
		async := true
		if bv, isB := get(o, "isAsync").(bool); isB {
			async = bv
		}
		if oc != "async-launched" || !async {
			return ""
		}
		k, ids, b = "agent", []any{get(o, "agentId")}, kernel.Obj{{K: "agent", V: get(o, "agentId")}}
	case "SendMessage":
		to := get(ti, "to")
		if !isID(to) {
			return ""
		}
		k, ids, b = "send", []any{to}, kernel.Obj{{K: "agent", V: to}}
	default:
		return ""
	}
	if shape {
		return lrdrop(t, "shape")
	}
	allID := true
	for _, x := range ids {
		allID = allID && isID(x)
	}
	if cs == nil || !allID {
		return lrdrop(t, "id")
	}
	row := kernel.Obj{{K: "v", V: 1}, {K: "t", V: t}, {K: "k", V: k}, {K: "w", V: w}, {K: "uuid", V: cs}}
	for _, kv := range b {
		row = set(row, kv.K, kv.V)
	}
	var sc any
	if ws {
		sc = lrpath(get(o, "scriptPath"), get(p, "transcript_path"), cs.(string))
		row = set(row, "script", sc)
	}
	j := string(kernel.JQCompact(row))
	if ws && sc == nil {
		return lrdrop(t, "path") + "\t" + j
	}
	return j
}

// Listing is `_hook_spool_listing`'s answer: List is `["a","b"]` (empty: unmeasured), Drop says a listing exists but
// cannot be kept (more names than the bound, or a name outside it).
type Listing struct {
	List string
	Drop bool
}

// ListingReads is what the listing asks of the filesystem, as the bash's builtin tests do (links followed by -d and
// -e, never by -L).
type ListingReads struct {
	DirNoLink  func(p string) bool             // `-d p && ! -L p`
	FileNoLink func(p string) bool             // `-f p && ! -L p`
	Head       func(p string) string           // `read -r -N 1024` of a file: its first 1024 bytes
	IsDir      func(p string) bool             // `-d p`
	Present    func(p string) bool             // `-e p || -L p`
	Searchable func(p string) bool             // `-r p && -x p`
	DirNames   func(p string) ([]string, bool) // every name under a directory but . and .., bytewise order; false: it cannot be read
}

// SpoolListing is `_hook_spool_listing`: the names under `<git-common-dir>/worktrees/`, found walking up from the cwd.
func SpoolListing(cwd string, r ListingReads) Listing {
	if !strings.HasPrefix(cwd, "/") {
		return Listing{}
	}
	d, common := cwd, ""
walk:
	for n := 0; n < 64; n++ {
		switch {
		case r.DirNoLink(d + "/.git"):
			common = d + "/.git"
			break walk
		case r.FileNoLink(d + "/.git"):
			g, _, _ := strings.Cut(r.Head(d+"/.git"), "\n")
			if !strings.HasPrefix(g, "gitdir: ") {
				return Listing{}
			}
			g = strings.TrimPrefix(g, "gitdir: ")
			if !strings.HasPrefix(g, "/") {
				g = d + "/" + g
			}
			const w = "/worktrees/"
			first, last := strings.Index(g, w), strings.LastIndex(g, w)
			if first < 0 || len(g) <= first+len(w) || strings.Contains(g[last+len(w):], "/") {
				return Listing{}
			}
			common = g[:last]
			break walk
		}
		i := strings.LastIndex(d, "/")
		if i < 0 || d == "/" {
			return Listing{}
		}
		if d = d[:i]; d == "" {
			d = "/"
		}
	}
	if common == "" || !r.IsDir(common) {
		return Listing{}
	}
	w := common + "/worktrees"
	if !r.Present(w) {
		return Listing{List: "[]"}
	}
	if !r.IsDir(w) || !r.Searchable(w) {
		return Listing{}
	}
	var out []string
	names, ok := r.DirNames(w)
	if !ok {
		return Listing{} // unreadable: unmeasured, no key (never an empty list)
	}
	for _, name := range names {
		if !r.IsDir(w + "/" + name) {
			continue
		}
		if len(out)+1 > vocab.DelegationSpoolBoundsListingNames || len(name) > vocab.DelegationSpoolBoundsListingNameBytes ||
			!listName.MatchString(name) {
			return Listing{Drop: true}
		}
		out = append(out, `"`+name+`"`)
	}
	return Listing{List: "[" + strings.Join(out, ",") + "]"}
}

// SpoolAppendLine is the top of `_hook_spool_append`: the listing spliced in as the line's last key (listing first
// to go), `truncated` set when a listing exists that cannot be kept, and whether the result is under the cap.
func SpoolAppendLine(line, cwd string, below int, listing func(cwd string) Listing) (string, bool) {
	const tr = `"truncated":true}`
	if cwd != "" && !strings.HasSuffix(line, tr) {
		l := listing(cwd)
		drop := l.Drop
		if l.List != "" {
			if cand := strings.TrimSuffix(line, "}") + `,"listing":` + l.List + "}"; len(cand)+1 < below {
				line = cand
			} else {
				drop = true
			}
		}
		if drop {
			line = strings.TrimSuffix(line, "}") + `,` + tr
		}
	}
	return line, len(line)+1 < below
}

// PruneOld is `_hook_spool_prune`'s selection: of the names in the owner's directory, the `<10 digits>.spool` files
// (isRegular says which are regular, not links) whose hour is older than the cutoff. A cutoff that is not 10 digits
// selects nothing (the bash returns 1).
func PruneOld(names []string, cut string, isRegular func(name string) bool) []string {
	if !bucketRE.MatchString(cut) {
		return nil
	}
	var old []string
	for _, n := range names {
		b, ok := strings.CutSuffix(n, ".spool")
		if ok && bucketRE.MatchString(b) && isRegular(n) && b < cut { // equal widths: text order is numeric order
			old = append(old, n)
		}
	}
	return old
}

// SpoolBucketOK is `[[ "$dsp_bucket" =~ ^[0-9]{10}$ && -n "$dsp_gen" ]]`.
func SpoolBucketOK(bucket, gen string) bool { return bucketRE.MatchString(bucket) && gen != "" }

// LaunchAppend is what `_hook_launch_record_append` writes after its guards: the lines (one write), or nothing. size is
// the file's bytes (0 when absent); sizeKnown false is an unreadable size.
func LaunchAppend(row string, size int64, sizeKnown bool, below int, nowMs int64) (text string, write bool) {
	l1, l2, _ := strings.Cut(row, "\t")
	add := int64(len(l1) + 1)
	if l2 != "" {
		add += int64(len(l2) + 1)
	}
	if !(below > len(l1)+1 && below > len(l2)+1) || !sizeKnown {
		return "", false
	}
	if size+add > LRCMaxBytes {
		drop := lrdropBudget(nowMs)
		if size+int64(len(drop))+1 > LRCMaxBytes+LRCDropReserve {
			return "", false
		}
		return drop + "\n", true
	}
	if l2 != "" {
		return l1 + "\n" + l2 + "\n", true
	}
	return l1 + "\n", true
}

func lrdropBudget(ms int64) string {
	return `{"v":1,"t":` + strconv.FormatInt(ms, 10) + `,"k":"drop","why":"budget"}`
}

// NulFree is what a `read` keeps of the bytes it was handed: NUL bytes are dropped (the generation, wrapper and listing reads).
func NulFree(b []byte) string { return strings.ReplaceAll(string(b), "\x00", "") }
