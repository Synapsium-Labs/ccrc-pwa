package attention

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// FableRE is FABLE_RE as jq's Oniguruma runs it: every string of testdata/fable-cases.jsonl against what real jq answered
// (testdata/gen-fable-golden.sh).
func TestFableGolden(t *testing.T) {
	cases, want := readLinesFile(t, "fable-cases.jsonl"), readLinesFile(t, "fable.golden")
	if len(cases) != len(want) {
		t.Fatalf("%d cases, %d golden lines: regenerate", len(cases), len(want))
	}
	yes := 0
	for i, line := range cases {
		var s string
		if err := json.Unmarshal([]byte(line), &s); err != nil {
			t.Fatal(err)
		}
		if got := FableRE(s); fmt.Sprint(got) != want[i] {
			t.Errorf("case %d %q: got %v want %s", i+1, s, got, want[i])
		}
		if want[i] == "true" {
			yes++
		}
	}
	if yes < 200 || yes > len(cases)-200 {
		t.Errorf("the corpus no longer exercises both answers: %d of %d match", yes, len(cases))
	}
}

// The pattern the goldens were measured from.
func TestFableREPinned(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh"))
	if err != nil {
		t.Fatal(err)
	}
	var line string
	for _, l := range strings.Split(strings.ReplaceAll(string(src), "\r\n", "\n"), "\n") {
		if strings.HasPrefix(l, "FABLE_RE=") {
			line = l
			break
		}
	}
	if line == "" {
		t.Fatal("ccd/session-hook.sh defines no FABLE_RE")
	}
	// the assignment is `FABLE_RE="…"` with `\"` and a backtick escaped for the shell: undo exactly those
	v := strings.TrimSuffix(strings.TrimPrefix(line, `FABLE_RE="`), `"`)
	v = strings.NewReplacer(`\"`, `"`, "\\"+"`", "`").Replace(v)
	got := fmt.Sprintf("%x", sha256.Sum256([]byte(v)))
	if want := strings.TrimSpace(readLinesFile(t, "fable-re.sha256")[0]); got != want {
		t.Errorf("FABLE_RE changed (sha256 %s, the goldens were measured from %s): run testdata/gen-fable-golden.sh with real jq and make FableRE match", got, want)
	}
}
