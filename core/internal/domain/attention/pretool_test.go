package attention

import (
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

func TestLandingAdvisory(t *testing.T) {
	syncs := []string{"git merge origin/main", "git pull origin main", "git rebase origin/main", "git -C /w/demo merge origin/main",
		"cd /w/demo && git merge origin/main && npm test", "git fetch origin && git merge -X theirs origin/HEAD", "git merge main",
		"gh pr update-branch 42", "gh api -X PUT repos/o/r/pulls/42/update-branch", `git merge "origin/main"`, "git merge 'origin/main'",
		"git -c merge.conflictstyle=diff3 merge origin/main", "git --no-pager merge origin/main", "GIT_EDITOR=true git merge origin/main",
		"git status\ngit merge origin/main", "git pull origin HEAD", "(cd /w/demo && git merge origin/main)", "{ git merge origin/main; }",
		`gh api graphql -f query='mutation { updatePullRequestBranch(input: {}) { x } }'`}
	not := []string{"git merge-tree --write-tree HEAD origin/HEAD", "git merge-base --is-ancestor HEAD origin/main", "git fetch origin main",
		"git merge feature/other", `echo "git merge origin/main"`, "git pull", `git commit -m "Workers now git merge origin/main only on a conflict"`,
		"git rebase -i HEAD~3\nlog origin HEAD", "git pull\nlog origin main", "git merge feature/x\ngit log origin main"}
	for _, c := range syncs {
		if !landingSync.MatchString(c) && !landingUb.MatchString(c) {
			t.Errorf("no advice on %q", c)
		}
	}
	for _, c := range not {
		if landingSync.MatchString(c) || landingUb.MatchString(c) {
			t.Errorf("advice on %q", c)
		}
	}
}

func TestFableRE(t *testing.T) {
	yes := []string{`model: "fable"`, `model:'fable'`, "model = `Fable`", `model(fable)`, `claude-fable-5`, `CLAUDE-FABLE`, `model : "foo/fable"`,
		`model: "a-b.c/fable"`, `my model,fable`, "model: fable", `model: xfable`}
	no := []string{`xmodel: fable`, `modelx: fable`, `model: opus // fable`, `a fable about a fox`, `models: fable`, `model: "a b"`, `Model: fable`, `model`, `model: "x fable"`}
	for _, s := range yes {
		if !FableRE(s) {
			t.Errorf("FableRE(%q) = false", s)
		}
	}
	for _, s := range no {
		if FableRE(s) {
			t.Errorf("FableRE(%q) = true", s)
		}
	}
}

func TestSkillName(t *testing.T) {
	v := func(s string) any { return parse(t, `{"tool_input":{"skill":`+s+`}}`) }
	for in, want := range map[string]string{`"ccrc-worker"`: "ccrc-worker", `" /ccrc-worker\t"`: "ccrc-worker", "\"\\u00a0\\u3000ccrc-worker\\ufeff\"": "ccrc-worker",
		`"//ccrc-worker"`: "/ccrc-worker", `5`: "5", `null`: "", `false`: "", `{"s":1}`: `{"s":1}`, `"ccrc-wo\u0000rker"`: "ccrc-worker", `" / a"`: " a"} {
		if got := skillName(v(in)); got != want {
			t.Errorf("skillName(%s) = %q, want %q", in, got, want)
		}
	}
	if skillName(parse(t, `{"tool_input":"str"}`)) != "" || skillName(parse(t, `{}`)) != "" {
		t.Error("a tool_input that is no object holds no skill")
	}
}

// Each arm answers in the bash's order, a deny is never replaced, and a nudge is advice with no decision.
func TestPreToolArmsOrder(t *testing.T) {
	rd := PreReads{Generation: func() bool { return true }, HasCcrc: func() bool { return true },
		Classify: func(string, bool) string { return "wrapped" }, ScriptStat: func(string) (bool, int64) { return false, 0 }, ScriptText: func(string) string { return "" },
		Reg: func(string) ([]byte, int) { return nil, 1 }, Exists: func(string) bool { return false }, AdminAllowed: func(string) bool { return false },
		DenyFile: func() ([]byte, bool) { return nil, false }}
	call := func(tool, input string, paid bool) PreOut {
		p := `{"hook_event_name":"PreToolUse","tool_name":"` + tool + `","tool_input":` + input + `}`
		return PreToolArms(PreIn{Tool: tool, Payload: p, V: parse(t, p), Paid: paid, Gq: "1", Gd: "0", Subs: "[]", UTF8: true}, rd)
	}
	// a Skill call from a subagent: the role-skill deny, and no denial charged to the graph gate
	if o := call("Skill", `{"skill":"ccrc-worker"}`, true); !strings.Contains(o.Json, `"permissionDecision":"deny"`) || o.GdPlus {
		t.Errorf("role skill: %+v", o)
	}
	// a Bash call naming systemd-run under a classifier that says wrapped: denied by the test route
	if o := call("Bash", `{"command":"systemd-run x vitest"}`, false); !strings.Contains(o.Json, "never under a systemd-run of your own") {
		t.Errorf("test route: %s", o.Json)
	}
	// the sync advisory is a nudge: no decision
	if o := call("Bash", `{"command":"git merge origin/main"}`, false); strings.Contains(o.Json, "permissionDecision") || !strings.Contains(o.Json, "landing advisory") {
		t.Errorf("landing: %s", o.Json)
	}
	// the merge deny on a top-level session: an admin merge is refused, a plain one is not (no hold, no child marker)
	if o := call("Bash", `{"command":"gh pr merge 5 --admin"}`, false); !strings.Contains(o.Json, "merges are refused in every session") {
		t.Errorf("admin merge: %s", o.Json)
	}
	if o := call("Bash", `{"command":"gh pr merge 5"}`, false); o.Json != "" {
		t.Errorf("plain merge on a top-level session: %s", o.Json)
	}
	// the account arm on every session
	if o := call("Bash", `{"command":"ccrc account remove --id lane-x"}`, false); !strings.Contains(o.Json, "ccrc account remove") {
		t.Errorf("account: %s", o.Json)
	}
	// a graph query in the session (Gq 1) turns the graph arm off: a search is let through
	if o := call("Grep", `{"pattern":"x"}`, false); o.Json != "" {
		t.Errorf("grep after a query: %s", o.Json)
	}
}

func TestScriptSource(t *testing.T) {
	rd := func(regular bool, size int64, text string) PreReads {
		return PreReads{ScriptStat: func(string) (bool, int64) { return regular, size }, ScriptText: func(string) string { return text }}
	}
	big := strings.Repeat(" ", 131071)
	for _, c := range []struct {
		name, goos string
		rd         PreReads
		want       string
	}{
		{"a regular file is read as $(cat) keeps it", "linux", rd(true, 5, "a\x00b\n\n"), "ab"},
		{"a link, a directory or an absent file is no source", "linux", rd(false, 0, "x"), ""},
		{"a file over 256 KiB is no source", "darwin", rd(true, 262145, "x"), ""},
		{"256 KiB itself is read off Linux", "darwin", rd(true, 262144, big+"x"), big + "x"},
		{"a word of 131071 bytes still execs on Linux", "linux", rd(true, 131071, big), big},
		{"131072 bytes is E2BIG there: the arm allows", "linux", rd(true, 131072, big+"x"), ""},
		{"and \"\" is linux", "", rd(true, 131072, big+"x"), ""},
	} {
		if got := scriptSource("/p", c.goos, c.rd); got != c.want {
			t.Errorf("%s: %d bytes, want %d", c.name, len(got), len(c.want))
		}
	}
}

func TestOSTypeLinux(t *testing.T) {
	for _, c := range []struct {
		goos, ostype string
		set, want    bool
	}{{"linux", "", false, true}, {"", "", false, true}, {"darwin", "", false, false}, {"windows", "", false, false}, {"linux", "darwin23", true, false},
		{"darwin", "linux-gnu", true, true}, {"linux", "", true, false}, {"linux", "linux-musl", true, true}} {
		if got := ostypeLinux(c.goos, c.ostype, c.set); got != c.want {
			t.Errorf("%+v: %v", c, got)
		}
	}
}

// The Go copies of the bash's values are the bash's: its own shell evaluates each assignment (the regular expressions, the role
// skills, the gate's bounds and the card's diff-list bound) and the Go constants equal what it computed, so a change to one side
// is red until the other follows.
func TestPreToolValuesAreTheBashs(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("no bash")
	}
	names := []string{"GRAPH_NUDGE_READ_RE", "GRAPH_NUDGE_PRE_RE", "GRAPH_SEARCH_RE", "LANDING_SYNC_RE", "LANDING_UB_RE", "ROLE_SKILLS",
		"GRAPH_GATE_MAX_BEHIND", "GRAPH_GATE_MAX_DENIALS", "CARD_MAX_CHARS", "CARD_DIFF_LIST_MAX_CHARS", "GRAPH_RUN"}
	script := `hook=../../../../ccd/session-hook.sh
for v in ` + strings.Join(names, " ") + `; do eval "$(grep -m1 "^$v=" "$hook")"; done
printf '%s\0' ` + "\"${" + strings.Join(names, "}\" \"${") + "}\""
	out, err := exec.Command(bash, "-c", script).Output()
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
	if len(got) != len(names) {
		t.Fatalf("bash answered %d values for %d names", len(got), len(names))
	}
	want := map[string]string{
		"GRAPH_NUDGE_READ_RE": graphNudgeReadRE, "GRAPH_NUDGE_PRE_RE": strings.TrimSuffix(graphNudgeReadRE, "$") + `"`, "GRAPH_SEARCH_RE": graphSearchRE,
		"LANDING_SYNC_RE": landingSyncRE, "LANDING_UB_RE": landingUbRE, "ROLE_SKILLS": RoleSkills, "GRAPH_GATE_MAX_BEHIND": strconv.Itoa(GraphGateMaxBehind),
		"GRAPH_GATE_MAX_DENIALS": strconv.Itoa(GraphGateMaxDenials), "CARD_MAX_CHARS": "2400", "CARD_DIFF_LIST_MAX_CHARS": strconv.Itoa(cardDiffListMax), "GRAPH_RUN": GraphRun,
	}
	for i, n := range names {
		if got[i] != want[n] {
			t.Errorf("%s: Go %q, bash %q", n, want[n], got[i])
		}
	}
}

// The shell's `[[ =~ ]]` is glibc regexec without REG_NEWLINE: `^` and `$` anchor the whole text and `[^…]` takes a newline. Each
// row below was measured on a glibc bash (bash, Go): a pattern compiled with CompilePOSIX, whose anchors are line anchors, answers
// the other way on every one.
func TestSingleLineMatchersAreWholeText(t *testing.T) {
	for _, c := range []struct {
		name string
		got  bool
		want bool
	}{
		{"search head on a later line", graphSearch.MatchString("echo hi\ngrep foo"), false},
		{"find on a later line", graphSearch.MatchString("ls\nfind . -name x"), false},
		{"cd's [^;&|]+ runs over a newline", graphSearch.MatchString("cd /x\nls && grep y"), true},
		{"a source extension ends the path, not a line", graphNudgeRead.MatchString("a.ts\nb"), false},
		{"the same, on the raw payload form", graphNudgePre.MatchString("\"a.ts\"\nb"), true},
		{"landing: an advice-less newline tail", landingUb.MatchString("x\n/update-branch"), true},
	} {
		if c.got != c.want {
			t.Errorf("%s: %v, want %v", c.name, c.got, c.want)
		}
	}
}

// jq -r prints an object or array pretty (several lines), rawOut compact. The callers that read a command, a path or a cwd cannot
// tell: both spellings begin with { or [ and end with } or ], so neither is a directory, a source extension or a search head.
func TestObjectInputsNeverMatchEitherWay(t *testing.T) {
	for _, s := range []string{`{"a":1}`, "{\n  \"a\": 1\n}", `["grep"]`, "[\n  \"grep\"\n]"} {
		if graphSearch.MatchString(s) || graphNudgeRead.MatchString(s) {
			t.Errorf("%q matched", s)
		}
	}
}
