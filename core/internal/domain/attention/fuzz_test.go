package attention

import (
	"strconv"
	"testing"

	"ccrc/core/internal/kernel"
)

// The deny deciders never panic: a panic in the hook is recovered into an empty answer, which allows where the bash would
// have answered (final review finding 10). `go test` runs each target over its seeds; `go test -fuzz=FuzzForbidden` (one
// target at a time) explores past them. The seeds are the shapes the review's 400,000-command hunt drew from: quotes,
// command substitutions, heredocs, ~/.ccrc paths, gh pr merge, NUL, U+2003 and a carriage return.
var fuzzSeeds = []string{
	"", "ls", `gh pr merge 12 --admin`, "cat ~/.ccrc/accounts.json", `cp x ~/.local/bin/claude`, "git worktree prune",
	`echo "$(gh pr merge 1)"`, "cat <<'A'\nx\nA\n", "a\x00b", "printenv x", "a\rb", `'unterminated`, "$(", "`",
	`sudo env A=1 git -C "$(x)/y" worktree prune`, "ccd ws-rm x", `bash -c 'ccrc account add a'`, "S=systemd-run; $S npx vitest run",
}

func FuzzForbidden(f *testing.F) {
	for _, s := range fuzzSeeds {
		for _, tool := range []string{"Bash", "Read", "Write", "Edit"} {
			f.Add(tool, s)
		}
	}
	f.Fuzz(func(t *testing.T, tool, cmd string) {
		v := kernel.Obj{{K: "tool_name", V: tool}, {K: "tool_input", V: kernel.Obj{{K: "command", V: cmd}, {K: "file_path", V: cmd}}}}
		for _, mode := range []string{"deny", "class", "account"} {
			Forbidden(v, mode, nil, nil)
		}
	})
}

func FuzzMergeStrip(f *testing.F) {
	for _, s := range fuzzSeeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, cmd string) {
		MergeStrip(kernel.Obj{{K: "tool_name", V: "Bash"}, {K: "tool_input", V: kernel.Obj{{K: "command", V: cmd}}}})
	})
}

// ApprovalGate over gateReads' ladder, every gate open, so a payload reaches the parse and the route's decision; the
// payload is fuzzed whole (not only its command), as the hook hands it over.
func FuzzApprovalGate(f *testing.F) {
	deny := []byte(`{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}` + "\n")
	for _, s := range fuzzSeeds {
		f.Add(`{"session_id":"s","tool_name":"Bash","cwd":"/w","tool_input":{"command":` + strconv.Quote(s) + `}}`)
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, payload string) {
		for _, utf := range []bool{true, false} {
			ApprovalGate(payload, "lane-a-project-a", "/home/x", utf, *gateReads(deny))
		}
	})
}
