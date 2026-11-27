package attention

import (
	"fmt"
	"runtime"
	"strings"
	"testing"
	"time"

	"ccrc/core/internal/kernel"
)

// The prune deny's cost bound (session-hook-prune-deny.test.ts, D-8334, review 1493 FD8) applies to the Go port too: on
// the same quote-dense payloads naming worktree and prune, each mode's work (CPU time, never wall time: D-8334) grows
// linearly, and every run ends well inside the hook's budget. Two shapes put prune and worktree in ONE long segment, so the
// prune row's GITWT walks the whole of it. The build guard's two timing pins (D-6063, D-6065: 43 KB of `cd ~/.local/ && `,
// 40 KB of build-path assignments) are held to the same bound.
//
// The bound is read over a factor of four, 64 KB to 256 KB, against 2.5 squared (6.25): linear work measures about 4x and
// quadratic about 16x, so the clock's noise cannot cross it either way. Each point is the mean per call over at least
// one second of CPU: with 250 ms windows a 64 KB point of about 20 ms was a few of Windows' 15.6 ms ticks, and the
// 64-to-128 KB ratio went past 2.5 on the tick alone, one run in three (final review finding 7; a 32 KB to 512 KB curve
// with 1 s windows measured x1.80 to x2.56 per doubling, linear).
func TestGuardCostBound(t *testing.T) {
	if testing.Short() {
		t.Skip("timing")
	}
	payload := func(cmd string) any {
		return kernel.Obj{{K: "tool_name", V: "Bash"}, {K: "tool_input", V: kernel.Obj{{K: "command", V: cmd}}}}
	}
	cost := func(cmd, mode string) time.Duration {
		v := payload(cmd)
		runtime.GC()
		c0, n := cpuNow(), 0
		for n == 0 || cpuNow()-c0 < time.Second {
			Forbidden(v, mode, nil, nil)
			n++
		}
		return (cpuNow() - c0) / time.Duration(n)
	}
	shapes := []struct {
		name string
		at   func(kb int) string
	}{
		{"quotes", func(kb int) string {
			u := `a "b c" 'd' \e `
			return "git worktree list --porcelain; echo prune " + strings.Repeat(u, kb*1024/len(u))
		}},
		{"dqsub", func(kb int) string {
			u := "$(x) `y` "
			return `git worktree list --porcelain; echo prune "` + strings.Repeat(u, kb*1024/len(u)) + `"`
		}},
		{"one-segment", func(kb int) string {
			u := "a/b \"c d\" "
			return "git worktree prune -n " + strings.Repeat(u, kb*1024/len(u))
		}},
		{"one-segment-operand", func(kb int) string {
			u := "$(x)/y "
			return "sudo env A=1 git -C \"" + strings.Repeat(u, kb*1024/len(u)) + "\" worktree prune"
		}},
		{"cd-local", func(kb int) string { u := "cd ~/.local/ && "; return strings.Repeat(u, kb*1024/len(u)) }},
		{"assignments", func(kb int) string {
			var b strings.Builder
			for i := 0; b.Len() < kb*1024; i++ {
				fmt.Fprintf(&b, "V%d=~/.local/bin/claude; ", i)
			}
			return b.String()
		}},
	}
	for _, s := range shapes {
		for _, mode := range []string{"deny", "class", "account"} {
			small, large := cost(s.at(64), mode), cost(s.at(256), mode)
			ratio := float64(large) / float64(small)
			t.Logf("%s/%s: 64 KB %v, 256 KB %v, %.2fx", s.name, mode, small, large, ratio)
			if ratio > 6.25 {
				t.Errorf("%s/%s: %.2fx from 64 to 256 KB, over the 6.25x (2.5 squared) bound", s.name, mode, ratio)
			}
			if large > 5*time.Second {
				t.Errorf("%s/%s: %v at 256 KB", s.name, mode, large)
			}
		}
	}
}

// pmglob's pattern is built from the command, so its match must not grow with the glob's stars (review F3: a recursive
// matcher took 51 s at 11 stars, past which the hook's timeout fails it open). The review's shapes, on every session's
// account arm and a child's deny mode: 9, 11, 13 and 64 stars before a letter no name holds, and `*a` 32 times.
func TestGuardGlobCost(t *testing.T) {
	if testing.Short() {
		t.Skip("timing")
	}
	for _, g := range []string{strings.Repeat("*", 9) + "Q", strings.Repeat("*", 11) + "Q", strings.Repeat("*", 13) + "Q",
		strings.Repeat("*", 64) + "Q", strings.Repeat("*a", 32) + "Q", strings.Repeat("*?", 32) + "Q", strings.Repeat("[!/]*", 12) + "Q"} {
		for _, cmd := range []string{"cat ~/.ccrc/" + g + "; printenv", "cat ~/.ccrc/" + g + "; cp x ~/.local/bin/claude"} {
			v := kernel.Obj{{K: "tool_name", V: "Bash"}, {K: "tool_input", V: kernel.Obj{{K: "command", V: cmd}}}}
			for _, mode := range []string{"account", "deny"} {
				c0 := cpuNow()
				Forbidden(v, mode, nil, nil)
				if d := cpuNow() - c0; d > 200*time.Millisecond {
					t.Fatalf("%q in %s mode: %v of CPU", cmd, mode, d)
				}
			}
		}
	}
}

// The strip's recursive scanners at the cap: a command of MERGE_PARSE_CAP bytes nested as deep as it can be, in each of
// the recursive groups, stays a few milliseconds (review F7).
func TestMergeStripCost(t *testing.T) {
	if testing.Short() {
		t.Skip("timing")
	}
	fill := func(open, close string) string {
		n := (MergeParseCap - len("echo \"\"")) / (len(open) + len(close))
		return "echo \"" + strings.Repeat(open, n) + strings.Repeat(close, n) + "\""
	}
	for _, cmd := range []string{fill(`$(echo "`, `")`), fill("${a:-", "}"), fill("$(", ")"), fill("(", ")"), fill("$(cat <<'A'\nx\nA\n", ")"),
		strings.Repeat(`"$(`, MergeParseCap/3), strings.Repeat("<<A\n", MergeParseCap/4)} {
		v := kernel.Obj{{K: "tool_name", V: "Bash"}, {K: "tool_input", V: kernel.Obj{{K: "command", V: cmd}}}}
		c0, n := cpuNow(), 0
		for n == 0 || cpuNow()-c0 < 100*time.Millisecond {
			MergeStrip(v)
			n++
		}
		if d := (cpuNow() - c0) / time.Duration(n); d > 20*time.Millisecond {
			t.Errorf("%.40q…: %v a strip", cmd, d)
		}
	}
}
