package attention

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// FanOutVerdict is the fan-out scanner's jq program: every case of testdata/fanout-cases.jsonl (the suites' own scripts and
// a seeded walk over the tokens the scanner reads) against what real jq printed for the program cut from
// ccd/session-hook.sh (testdata/gen-fanout-golden.sh). Red when the Go walk changes shape.
func TestFanOutGolden(t *testing.T) {
	cases, want := readLinesFile(t, "fanout-cases.jsonl"), readLinesFile(t, "fanout.golden")
	if len(cases) != len(want) {
		t.Fatalf("%d cases, %d golden lines: regenerate", len(cases), len(want))
	}
	words := map[string]int{}
	for i, line := range cases {
		c := parse(t, line)
		file, _ := get(c, "file").(string)
		got := FanOutVerdict(get(c, "p"), file)
		words[got]++
		if got != want[i] {
			t.Errorf("case %d: got %q want %q\n%s", i+1, got, want[i], line)
			if i > 30 {
				t.FailNow()
			}
		}
	}
	if words["agent"] == 0 || words["workflow"] < 100 || words[""] < 100 {
		t.Errorf("the corpus no longer exercises every verdict: %v", words)
	}
}

// The goldens are only as current as the program they were measured from.
func TestFanOutProgramPinned(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh"))
	if err != nil {
		t.Fatal(err)
	}
	s := strings.ReplaceAll(string(src), "\r\n", "\n")
	const open, closing = "fo=$(jq -r --arg file \"$fosrc\" '\n", "' <<<\"$payload\" 2>/dev/null) || fo=\"\""
	a := strings.Index(s, open)
	if a < 0 {
		t.Fatal("ccd/session-hook.sh has no fan-out program")
	}
	b := strings.Index(s[a:], closing)
	if b < 0 {
		t.Fatal("the fan-out program's closing quote not found")
	}
	got := fmt.Sprintf("%x", sha256.Sum256([]byte(s[a+len(open):a+b])))
	if want := strings.TrimSpace(readLinesFile(t, "fanout-program.sha256")[0]); got != want {
		t.Errorf("the fan-out program changed (sha256 %s, the goldens were measured from %s): run testdata/gen-fanout-golden.sh "+
			"with real jq and make FanOutVerdict match the new goldens", got, want)
	}
}

// GraphRun is the command the gate and the nudge teach (GRAPH_RUN), and the bash's constant is the one ccd-session-path
// cuts to prove it answers in a started session: the Go constant is held to the bash's text here, and
// ccd-session-path.test.ts holds the Go source's to the same, so a pane's PATH step serves whichever hook taught it.
func TestGraphRunIsTheBashs(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^GRAPH_RUN='(.*)'\r?$`).FindSubmatch(src)
	if m == nil {
		t.Fatal("ccd/session-hook.sh defines no GRAPH_RUN")
	}
	if string(m[1]) != GraphRun {
		t.Errorf("GraphRun %q is not the bash's GRAPH_RUN %q", GraphRun, m[1])
	}
}
