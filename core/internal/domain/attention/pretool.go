package attention

import (
	"regexp"
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
)

// The PreToolUse arms on plain regexes (ccd/session-hook.sh, tail stage 12): the graph gate and nudge, the landing
// advisory, the role-skill deny, Fable, the test route, the reader arms and the fan-out pin, each in the bash's order and
// each skipped once a deny stands, the merge deny and the account, child, quiz, prune and build deny among them (wave 2
// Task 5, guardarms.go). The mail hold runs after them, in MailHold. Every read (the graph's files and git, a Workflow script, the ccrc
// classifier) is the caller's, asked through PreReads only where the bash asks it.

// PreIn is what the arms decide from: the event's parse and the hookstate's counters, as the bash holds them at stage 12.
type PreIn struct {
	Tool, Payload        string // `$tool` and the raw payload text
	V                    any    // the payload as jq reads it
	Paid, Tmsub          bool   // an agent_id is set; the agent is a recorded joiner
	Subs                 string // the roster's JSON text (stage 10's)
	Unreadable           bool   // the hookstate exists and will not parse (D-1613)
	Gq, Gd               string // graphQueries and graphGateDenials as decimal text
	GateOff              bool   // `-e ~/.ccrc/graph-gate-off`
	UTF8                 bool
	Paned                bool   // the session was identified by its tmux pane (TMUX_PANE is set), not by the job-directory fallback
	GOOS                 string // runtime.GOOS ("" is linux): what the argv limit and the OSTYPE default follow
	OSType               string // OSTYPE as the environment holds it, when OSTypeSet (bash keeps an imported one, an empty one too)
	OSTypeSet            bool
	DoorNonce            string // CCRC_DOOR_NONCE_SHA256
	Force, SubagentModel string // CLAUDE_CODE_SUBAGENT_MODEL_FORCE and CLAUDE_CODE_SUBAGENT_MODEL
	ID                   string // the session id
	Home                 string // HOME, as the guard's jq reads $ENV.HOME
	// Miss is a session lookup that matched no session (Task 9c, D-TBD-go-hook-lookup-miss): ID is empty and no session
	// fact is read. A row that needs one takes its refusing side (the child's rows, the heavy route, a subagent's door
	// write, the admin-merge allowance unproved), except a coordinator's own acts (the wave's plain merge, the approval
	// surface); the graph gate and the landing advisory do not run.
	Miss bool
}

// PreReads are the observations the arms ask for.
type PreReads struct {
	Graph        GraphIO
	Generation   func() bool                                  // `[[ -f $REG/<id>.generation ]]`
	ScriptStat   func(path string) (regular bool, size int64) // `[[ -f p && ! -L p ]]` and the size: a link is no regular file here
	ScriptText   func(path string) string                     // `cat -- p`: the bytes, "" when it cannot be read
	HasCcrc      func() bool                                  // `command -v ccrc`
	Classify     func(cmd string, bounded bool) string        // `ccrc test --classify-shell -- cmd`, as `$( )` keeps it: "" when it fails
	Reg          RegRead                                      // `_ct_read $REG/<name>`'s inputs
	Exists       func(name string) bool                       // `[[ -e $REG/<name> ]]`
	AdminAllowed func(project string) bool                    // `[[ -f $REG/admin-merge-allowed/<p> && ! -L … ]]`
	DenyFile     func() ([]byte, bool)                        // `[[ -f $REG/child-deny.settings.json && ! -L … ]]` and DenyReadMax of its bytes
}

// PreOut is the envelope the arms built ("" when none) and whether the gate charged a denial.
type PreOut struct {
	Json   string
	GdPlus bool
}

const (
	// GraphRun is GRAPH_RUN: `$HOME` and `$PATH` stay literal for the session's shell to expand (D-8333).
	GraphRun         = `PATH="$HOME/.local/bin:$PATH" graphify`
	denyMark         = `"permissionDecision":"deny"`
	graphNudgeReadRE = `\.(py|js|ts|tsx|jsx|astro|vue|svelte|go|rs|java|rb|c|h|cpp|hpp|cc|cs|kt|swift|php|scala|lua|sh|md|rst|txt|mdx)$`
	graphSearchRE    = `^[[:space:]]*(cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(rg|grep|egrep|fgrep|ugrep|ag|ack|find|fd|git[[:space:]]+grep)([[:space:]]|$)`
	landingSyncRE    = "(^|[;&|({\n])[[:blank:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|({]*[[:blank:]]+)*git([[:blank:]]+(-[Cc][[:blank:]]+[^[:space:];&|({]+|--[a-z-]+(=[^[:space:];&|({]+)?))*[[:blank:]]+(merge|pull|rebase)([[:blank:]]+[^[:space:];&|({]+)*[[:blank:]]+(origin/main|origin[[:blank:]]+main|origin/HEAD|origin[[:blank:]]+HEAD|main|\"(origin/main|origin/HEAD|main)\"|'(origin/main|origin/HEAD|main)')([[:space:];&|)]|$)"
	landingUbRE      = `gh[[:space:]]+pr[[:space:]]+update-branch|/update-branch([^A-Za-z0-9_-]|$)|updatePullRequestBranch`
	RoleSkills       = "ccrc-worker ccrc-reviewer ccrc-coordinator ccrc-overlord"
)

// The shell's patterns are POSIX EREs, each only ever tested for a match, so RE2's leftmost-first agrees with the bash's
// leftmost-longest. They are compiled in Perl mode, NOT CompilePOSIX: glibc's regexec (no REG_NEWLINE) anchors ^ and $ at the whole
// text and lets [^...] take a newline, and CompilePOSIX makes ^ and $ line anchors and [^...] refuse one (a multi-line command then
// gated differently: TestSingleLineMatchersAreWholeText). The classes are ASCII (D-TBD-go-hook-ere-ascii-classes: glibc's
// [[:space:]] under a UTF-8 locale also holds U+2003 and its kin).
var (
	graphNudgeRead = regexp.MustCompile(graphNudgeReadRE)
	// GRAPH_NUDGE_PRE_RE: the same alternation with the JSON string terminator in place of end-of-line (DERIVED, never re-spelled).
	graphNudgePre = regexp.MustCompile(strings.TrimSuffix(graphNudgeReadRE, "$") + `"`)
	graphSearch   = regexp.MustCompile(graphSearchRE)
	landingSync   = regexp.MustCompile(landingSyncRE)
	landingUb     = regexp.MustCompile(landingUbRE)
	hasSearchWord = []string{"rg", "grep", "ag", "ack", "find", "fd"}
	heavyWords    = []string{"vitest", "jest", "tsc", "tsgo", "typecheck", "playwright", "stryker", "npm", "pnpm", "yarn", "bun", "make"}
)

func hookEnvelope(key, text string) string {
	inner := kernel.Obj{{K: "hookEventName", V: "PreToolUse"}}
	if key == "permissionDecisionReason" {
		inner = append(inner, kernel.KV{K: "permissionDecision", V: "deny"})
	}
	return string(kernel.JQCompact(kernel.Obj{{K: "hookSpecificOutput", V: append(inner, kernel.KV{K: key, V: text})}}))
}

// DenyJSON is `_hook_deny_json`: PreToolUse's deny, one line.
func DenyJSON(reason string) string { return hookEnvelope("permissionDecisionReason", reason) }

// NudgeJSON is `_hook_nudge_json`: PreToolUse's additionalContext, with no decision.
func NudgeJSON(text string) string { return hookEnvelope("additionalContext", text) }

func denied(pre string) bool { return strings.Contains(pre, denyMark) }

// Denied is `[[ $pre_json == *'"permissionDecision":"deny"'* ]]`: a deny is built.
func Denied(pre string) bool { return denied(pre) }

// lower is `${x,,}`: every character in a UTF-8 locale, ASCII only otherwise. (D-TBD-go-hook-lowercase: Go's tables are Unicode 17,
// glibc's older; the lowered text is only matched against ASCII extensions and `fable`, which no code point assigned since lowers into.)
func lower(s string, utf bool) string {
	if utf {
		return strings.ToLower(s)
	}
	return strings.Map(asciiLower, s)
}

// inputString is `jq -r '.tool_input.<k> // ""'` as `$( )` keeps it (an object or array jq -r prints pretty and rawOut compact: no
// caller can tell, both begin with { or [ and end with } or ], so neither is a directory, a source extension or a search head), ok false where jq errors (a tool_input that is no object).
func inputString(v any, k string) (string, bool) {
	x, err := path(v, "tool_input", k)
	if err != nil {
		return "", false
	}
	if !truthy(x) {
		return "", true
	}
	return cmdSub(rawOut(x)), true
}

// PreToolArms runs the arms in the bash's order. A deny stands once built: every later arm that is guarded by it is
// skipped, and a nudge may still be replaced by a later arm's envelope, as in the bash.
func PreToolArms(in PreIn, rd PreReads) PreOut {
	var o PreOut
	pre := ""
	tool := in.Tool

	// ── The search gate and the Read nudge (D-1613, D-1745) ──
	if !in.Miss && !in.Unreadable && numTest(in.Gq, "==", 0) && !in.GateOff {
		gated, nudged := false, false
		switch tool {
		case "Grep", "Glob":
			gated = true
		case "Read":
			// Lowercased before every match (D-1797): graphify's own hook-guard lowercases the path, and so does this.
			if graphNudgePre.MatchString(lower(in.Payload, in.UTF8)) {
				fpath := ""
				if equal(get(in.V, "tool_name"), "Read") {
					fpath, _ = inputString(in.V, "file_path")
				}
				lp := lower(fpath, in.UTF8)
				// NEVER under graphify-out/, at any depth: the card sends the session to GRAPH_REPORT.md by name.
				if fpath != "" && graphNudgeRead.MatchString(lp) && !strings.HasPrefix(lp, "graphify-out/") && !strings.Contains(lp, "/graphify-out/") {
					nudged = true
				}
			}
		case "Bash":
			if containsAny(in.Payload, hasSearchWord...) {
				scmd := ""
				if equal(get(in.V, "tool_name"), "Bash") {
					scmd, _ = inputString(in.V, "command")
				}
				gated = scmd != "" && graphSearch.MatchString(scmd)
			}
		}
		// The bound is decided here and nowhere else (D-1797): the last conjunct, after the measurement, because the
		// bound is the measured tree's.
		if gated {
			if g, rc := MeasureGraph(in.V, rd.Graph); rc == 0 && g.GateTree() && numTestPair(in.Gd, g.MaxDenials) {
				gd, _ := strconv.ParseInt(in.Gd, 10, 64)
				r := "graphify gate: this tree has a knowledge graph ("
				if g.Nodes != "" {
					r += g.Nodes + " nodes, "
				}
				r += g.Fresh + ") and this session has no answer from it yet."
				r += " Search tools open after one graph query that answers — run: `" + GraphRun + " query \"<your question in plain words>\"` (`" + GraphRun + " path \"<A>\" \"<B>\"` for a relationship, `" + GraphRun + " explain \"<concept>\"` for one concept)."
				r += " Denial " + strconv.FormatInt(gd+1, 10) + " of " + g.MaxDenials + "; after " + g.MaxDenials + " the gate opens anyway."
				pre, o.GdPlus = DenyJSON(r), true
			}
		} else if nudged {
			if g, rc := MeasureGraph(in.V, rd.Graph); rc == 0 && g.GateTree() {
				r := "graphify: this tree has a knowledge graph ("
				if g.Nodes != "" {
					r += g.Nodes + " nodes, "
				}
				r += g.Fresh + ") and this session has no answer from it yet."
				r += " Before reading files to orient, run: `" + GraphRun + " query \"<your question in plain words>\"` (`" + GraphRun + " explain \"<concept>\"` for one concept)."
				r += " Reading a named file to edit it needs no query."
				pre = NudgeJSON(r)
			}
		}
	}

	// ── The landing-order advisory (landing-order spec 2026-09-23 §5.1): advice, never a decision ──
	p := in.Payload
	if !in.Miss && pre == "" && tool == "Bash" &&
		((strings.Contains(p, "main") || strings.Contains(p, "origin")) && (strings.Contains(p, "merge") || strings.Contains(p, "pull") || strings.Contains(p, "rebase")) ||
			strings.Contains(p, "update-branch") || strings.Contains(p, "updatePullRequestBranch")) {
		lcmd := ""
		if x, err := path(in.V, "tool_input", "command"); err == nil { // `.tool_input.command // "" | tostring`
			lcmd = cmdSub(tostring(or(x, "")))
		}
		if lcmd != "" && (landingSync.MatchString(lcmd) || landingUb.MatchString(lcmd)) {
			pre = NudgeJSON(landingReason)
		}
	}

	// ── The worker merge deny (landing-order R5, D-7249, D-8124) ──
	if !denied(pre) {
		if r := MergeDeny(in, rd); r != "" {
			pre = r
		}
	}

	// ── The role-skill deny (D-4934) ──
	if tool == "Skill" && in.Paid && !denied(pre) {
		rsk := skillName(in.V)
		rbare := rsk
		if i := strings.Index(rsk, ":"); i >= 0 {
			rbare = rsk[i+1:]
		}
		for _, name := range strings.Fields(RoleSkills) {
			if rsk == name || rbare == name {
				pre = DenyJSON("ccrc: this call loads the `" + name + "` skill from a subagent (a session started by another session's Agent tool or a workflow agent() call), and that skill makes whoever loads it act as the session." +
					" A subagent never acks, claims or sends ccrc mail and never opens or dispatches a run: do the task you were given and return your report to your parent.")
				break
			}
		}
	}

	// ── The child's approval-surface, forbidden-verb and build deny, and the account, quiz and prune rows (D-5297, D-6202) ──
	if !denied(pre) {
		if r := AccountDeny(in, rd); r != "" {
			pre = r
		}
	}

	// ── Fable runs only when the operator selects it (D-6792) ──
	if !denied(pre) && (tool == "Agent" || tool == "Task" || tool == "Workflow") && strings.Contains(lower(p, in.UTF8), "fable") {
		if namesFable(in.V) {
			pre = DenyJSON("ccrc: this " + tool + " call names a Fable model. Fable runs only when the operator selects it (operator ruling 2026-10-24; D-6792): a coordinator, a worker, an agent or a script never picks it. Use opus, sonnet or haiku for the agent's model instead, and leave the choice of Fable to the operator.")
		}
	}

	// ── Tests run through `ccrc test` (D-7298) ──
	if !denied(pre) && tool == "Bash" {
		// a lookup miss takes the refusing side: `ccrc test` is on PATH whenever this arm asks, so a heavy run has a way through
		fleet := ostypeLinux(in.GOOS, in.OSType, in.OSTypeSet) && (in.Miss || rd.Generation())
		task := false
		switch {
		case strings.Contains(p, "systemd-run"):
			task = true
		case containsAny(p, heavyWords...):
			task = fleet
		}
		if task && rd.HasCcrc() {
			tcmd := ""
			if x, err := path(in.V, "tool_input", "command"); err == nil {
				if s, ok := or(x, "").(string); ok { // `.tool_input.command // "" | strings`
					tcmd = cmdSub(s)
				}
			}
			verdict := ""
			if tcmd != "" {
				// `${hooktmo:+"$hooktmo" 5}`: bash sets hooktmo in the pane's branch only, so a session identified by its pane has the
				// classifier cut at 5 s and a pane-less (job directory) one runs it to its end.
				verdict = rd.Classify(tcmd, in.Paned)
			}
			switch {
			case verdict == "wrapped":
				pre = DenyJSON("ccrc: run tests and typechecks through `ccrc test -- <command>` (for example `ccrc test -- npx vitest run --maxWorkers=2 test/foo.test.ts`), never under a systemd-run of your own: `ccrc test` puts the run in the fleet's test slice, whose caps keep sessions ahead of tests, and queues heavy runs (tsc, typecheck, full or wide vitest, browser and mutation tests) fleet-wide (D-7298).")
			case verdict == "heavy" && fleet:
				pre = DenyJSON("ccrc: this command starts a heavy test or typecheck outside `ccrc test`, so it would run in this session's own scope, past the fleet's test slice and its queue. Run it as `ccrc test -- <command>` (for example `ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json`): heavy runs (tsc, typecheck, full or wide vitest, browser and mutation tests) queue fleet-wide inside the slice, whose caps keep sessions ahead of tests (D-7298).")
			}
		}
	}

	// ── The reader arms (Overlord W1 door process B2, C55): each keyed on a fact, never a role's name ──
	if !denied(pre) {
		rdn := ""
		switch {
		case tool == "mcp__door__read":
		case strings.HasPrefix(tool, "mcp__door__") && len(tool) > len("mcp__door__"):
			if in.Tmsub || in.Miss && in.Paid || nonEmptyAgentType(in.V) {
				rdn = "ccrc: a reader holds no write door (C55): a subagent here may call only the read tool, `mcp__door__read`. Hand anything else back to the main thread in your answer."
			}
		case tool == "Agent" || tool == "Task":
			if !in.Paid && isHex64(in.DoorNonce) && subsLen(in.Subs) >= 3 {
				rdn = "ccrc: three readers already run (C55's bound): wait for one to finish before starting another."
			}
			if rdn == "" && in.Force == "1" && in.SubagentModel != "" {
				if m, err := path(in.V, "tool_input", "model"); err == nil { // `.tool_input.model | strings`
					if s, ok := m.(string); ok && cmdSub(s) != "" && cmdSub(s) != in.SubagentModel {
						rdn = "ccrc: a subagent here runs on the pinned model, " + in.SubagentModel + "; this call names " + cmdSub(s) + ". Leave the model out, or name the pinned one."
					}
				}
			}
		}
		if rdn != "" {
			pre = DenyJSON(rdn)
		}
	}

	// ── A fan-out names its model, and a Workflow agent its effort too (D-6798) ──
	if !denied(pre) && (tool == "Agent" || tool == "Task" || tool == "Workflow") {
		src := ""
		if tool == "Workflow" {
			if ti, err := path(in.V, "tool_input"); err == nil && typeName(ti) == "object" {
				if _, isStr := get(ti, "script").(string); !isStr {
					if sp, ok := get(ti, "scriptPath").(string); ok {
						if fp := cmdSub(sp); fp != "" {
							src = scriptSource(fp, in.GOOS, rd)
						}
					}
				}
			}
		}
		fo := ""
		// A Workflow call pays the character walk only when the word `agent` appears at all.
		if tool != "Workflow" || strings.Contains(p+src, "agent") {
			fo = FanOutVerdict(in.V, src)
		}
		if fo == "agent" && in.Force == "1" && in.SubagentModel != "" {
			fo = "" // the pin: under FORCE the payload carries no model even when the call named one (W0-11)
		}
		if fo == "agent" || fo == "workflow" {
			name := "has an agent() call that names no model or no effort (a haiku call needs no effort)"
			if fo == "agent" {
				name = "names no model"
			}
			pre = DenyJSON("ccrc: this " + tool + " call " + name + ", so it would run at the lane default (operator ruling 2026-10-24; D-6798). Name them from the routing matrix: pass model (opus, sonnet or haiku) on an Agent or Task call, and model on every agent() call in a Workflow script, and effort too unless the model is haiku (haiku takes no effort level). Take the row for the work: a mechanical task is haiku or sonnet, judgement is opus.")
		}
	}

	// The mail hold (`_hook_mail_hold`) runs next, after the last deny arm and while no deny is built: MailHold, from L4.
	o.Json = pre
	return o
}

// numTestPair is `[[ "$gd" -lt "$max" ]]`: false where either is no integer.
func numTestPair(gd, max string) bool {
	m, err := strconv.ParseInt(max, 10, 64)
	return err == nil && numTest(gd, "<", m)
}

const landingReason = "ccrc landing advisory: this command brings main into the current branch. Absorb main only on one of three triggers:" +
	" (1) the branch conflicts — probe with `git fetch origin && git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD`: exit 1 with a tree id on the first line is a conflict, exit 0 is clean, and any other answer is unmeasured and licenses nothing;" +
	" (2) a required check on the PR is red while main passes the same tests: re-run its failing test files on a clean checkout of `origin/HEAD` in scratch, and a red there too is a red main also shows (report it once as main-red and leave main alone);" +
	" (3) the coordinator's fix-round mail names this PR ejected from the landing line with a base sha, or next to land in a strict-protection repository." +
	" Otherwise leave main alone: a clean branch lands as it is, and every needless sync restarts CI." +
	" When you do absorb: `git merge` only — never a rebase, a force-push or the Update branch of GitHub (its button, `gh pr` verb or API) — and on a conflict in a `# ccrc:generated` stamp line, take either side of that line only, resolve the rest of the file as source, then run `~/.local/bin/ccrc restamp <file>` (`ccd/ccd` carries no committed stamp, so it never has one)."

// jsTrimSpace is the role-skill deny's `ws`: the characters JavaScript's String.prototype.trim removes.
func jsTrimSpace(r rune) bool {
	return r == 32 || r >= 9 && r <= 13 || r == 160 || r == 5760 || r >= 8192 && r <= 8202 || r == 8232 || r == 8233 || r == 8239 || r == 8287 || r == 12288 || r == 65279
}

// skillName is the role-skill deny's one jq: `.tool_input.skill? // "" | tostring`, trimmed at both ends as Claude Code's
// Skill tool trims it, ONE leading slash stripped, as `$( )` keeps it (a NUL byte is dropped there).
func skillName(v any) string {
	x := get(v, "tool_input", "skill") // `.skill?`: an error is no value
	if !truthy(x) {
		return ""
	}
	r := []rune(tostring(x))
	for len(r) > 0 && jsTrimSpace(r[0]) {
		r = r[1:]
	}
	for len(r) > 0 && jsTrimSpace(r[len(r)-1]) {
		r = r[:len(r)-1]
	}
	if len(r) > 0 && r[0] == '/' {
		r = r[1:]
	}
	return cmdSub(string(r))
}

func nonEmptyAgentType(v any) bool { // `jq -e '(.agent_type | type) == "string" and .agent_type != ""'`
	s, ok := get(v, "agent_type").(string)
	return ok && s != ""
}

func subsLen(subs string) int { // `jq 'length' <<<"$subs"`, 0 where jq fails
	v, err := kernel.JQParse([]byte(subs))
	if err != nil {
		return 0
	}
	switch x := v.(type) {
	case []any:
		return len(x)
	case kernel.Obj:
		return len(x)
	}
	return 0
}

// namesFable is the Fable arm's jq: an Agent or Task call whose model names Fable, or a Workflow call whose script or
// input names a Fable model for an agent (a `model` member, or FABLE_RE over any string in the input). An error (a
// tool_input that has no model to index) is no verdict.
func namesFable(v any) bool {
	tool := get(v, "tool_name")
	in := get(v, "tool_input")
	switch {
	case equal(tool, "Agent") || equal(tool, "Task"):
		m, err := path(v, "tool_input", "model")
		s, ok := m.(string)
		return err == nil && ok && strings.Contains(strings.Map(asciiLower, s), "fable")
	case equal(tool, "Workflow"):
		return anyFable(in)
	}
	return false
}

// anyFable walks `$i | ..`: an object's `model` string naming fable, or any string FABLE_RE matches.
func anyFable(v any) bool {
	switch x := v.(type) {
	case string:
		return FableRE(x)
	case []any:
		for _, e := range x {
			if anyFable(e) {
				return true
			}
		}
	case kernel.Obj:
		for _, kv := range x {
			if s, ok := kv.V.(string); ok && kv.K == "model" && strings.Contains(strings.Map(asciiLower, s), "fable") {
				return true
			}
			if anyFable(kv.V) {
				return true
			}
		}
	}
	return false
}

// FableRE is FABLE_RE, which jq runs as an Oniguruma pattern over each string:
//
//	(^|[^[:alnum:]_])model["'`]?[[:space:]]*[:=,(][[:space:]]*["'`]?[[:alnum:]_./-]*[Ff][Aa][Bb][Ll][Ee]|[Cc][Ll][Aa][Uu][Dd][Ee]-[Ff][Aa][Bb][Ll][Ee]
//
// written as a scan: `model` (not glued to a word character before it), an optional quote, blanks, one of `:=,(`, blanks,
// an optional quote, and then "fable" somewhere in the run of word, dot, slash and dash characters that follows (the
// pattern's star may take any prefix of that run); or `claude-fable`, in any case. The classes are Oniguruma's (Unicode
// alnum and space) as far as Go's tables go (D-TBD-go-hook-unicode-tables).
func FableRE(s string) bool {
	if strings.Contains(strings.Map(asciiLower, s), "claude-fable") {
		return true
	}
	rs := []rune(s)
	for p := 0; p+5 <= len(rs); p++ {
		if string(rs[p:p+5]) != "model" || p > 0 && (onigAlnum(rs[p-1]) || rs[p-1] == '_') {
			continue
		}
		i := p + 5
		if i < len(rs) && fanQuote(rs[i]) {
			i++
		}
		for i < len(rs) && onigSpace(rs[i]) {
			i++
		}
		if i >= len(rs) || !strings.ContainsRune(":=,(", rs[i]) {
			continue
		}
		i++
		for i < len(rs) && onigSpace(rs[i]) {
			i++
		}
		if i < len(rs) && fanQuote(rs[i]) {
			i++
		}
		j := i
		for j < len(rs) && (onigAlnum(rs[j]) || strings.ContainsRune("_./-", rs[j])) {
			j++
		}
		if strings.Contains(strings.Map(asciiLower, string(rs[i:j])), "fable") {
			return true
		}
	}
	return false
}

// scriptSource is the fan-out arm's read of a Workflow's scriptPath: a regular, unlinked file of at most 256 KiB, read with
// `$(cat -- p)` (no NUL byte, no trailing newline); anything else is no source. The size is a stat and the text one read
// (D-TBD-go-hook-no-wc-rm). Then the text travels as `jq --arg file`, ONE argv word: on Linux the kernel refuses a word of
// 131072 bytes with its NUL, the exec fails and the arm allows, whatever the 256 KiB bound says (D-TBD-go-hook-script-argmax:
// MAX_ARG_STRLEN is 32 pages, so 131072 holds on a 4 KiB-page Linux (x86-64, the fleet); a 16 or 64 KiB-page kernel allows 512 KiB or
// 2 MiB there and the bash would then walk a larger script than this does. macOS and MSYS bound the whole argument list instead,
// which is not reproduced).
func scriptSource(p, goos string, rd PreReads) string {
	if regular, size := rd.ScriptStat(p); !regular || size > 262144 {
		return ""
	}
	src := cmdSub(rd.ScriptText(p))
	if (goos == "" || goos == "linux") && len(src) > 131071 {
		return ""
	}
	return src
}

// ostypeLinux is `[[ "${OSTYPE:-}" == linux* ]]`: bash sets OSTYPE itself unless the environment brings one (an empty one too).
func ostypeLinux(goos, ostype string, set bool) bool {
	if set {
		return strings.HasPrefix(ostype, "linux")
	}
	return goos == "" || goos == "linux"
}
