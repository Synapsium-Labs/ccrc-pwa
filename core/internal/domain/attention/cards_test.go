package attention

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestSweepRowMeasured holds SweepRow to real jq (testdata/gen-sweep-golden.sh): for every case, the row bash keeps,
// `$(jq …) || row=""`, is SweepRow's (a non-zero exit is no row; else stdout less its trailing newlines and NUL bytes).
// The program the golden ran is the one cut from the hook's text, so an edit to the bash's program reds here first.
func TestSweepRowMeasured(t *testing.T) {
	prog, err := os.ReadFile("testdata/sweep-program.txt")
	if err != nil {
		t.Fatal(err)
	}
	hook, err := os.ReadFile("../../../../ccd/session-hook.sh")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimRight(string(prog), "\n"), "\n")
	lines[0] = "'" + lines[0]
	if !strings.Contains(string(hook), strings.Join(lines, "\n")) {
		t.Fatal("the hook's census program is not the one the golden measured: regenerate testdata/sweep.golden")
	}
	gf, err := os.Open("testdata/sweep.golden")
	if err != nil {
		t.Fatal(err)
	}
	defer gf.Close()
	cf, err := os.ReadFile("testdata/sweep-cases.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	g := bufio.NewScanner(gf)
	g.Scan() // jq's version
	n := 0
	for _, line := range strings.Split(strings.TrimRight(string(cf), "\n"), "\n") {
		var c struct{ File, Src string }
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			t.Fatal(err)
		}
		if !g.Scan() {
			t.Fatal("the golden is shorter than the cases")
		}
		rc, hx, _ := strings.Cut(g.Text(), " ")
		want := ""
		if rc == "0" && hx != "-" {
			b, _ := hex.DecodeString(hx)
			want = cmdSub(string(b))
		}
		if got := SweepRow([]byte(c.File), true, c.Src); got != want {
			t.Errorf("case %d %s (src %q): got %q, jq kept %q (exit %s)", n, c.File, c.Src, got, want, rc)
		}
		n++
	}
	if n < 100 {
		t.Fatalf("only %d cases", n)
	}
	if SweepRow([]byte(`{"passes":[{"repos":[{"source":"/s","reason":"r"}]}]}`), false, "/s") != "" {
		t.Error("a census jq cannot open is no row")
	}
}

// TestScopeMsPinned holds scopeMsPattern to its owner, the stamp test `_hook_history_card` spells in the hook.
func TestScopeMsPinned(t *testing.T) {
	hook, err := os.ReadFile("../../../../ccd/session-hook.sh")
	if err != nil {
		t.Fatal(err)
	}
	if want := `[[ "$ms" =~ ^` + scopeMsPattern + `$ ]]`; !strings.Contains(string(hook), want) {
		t.Fatalf("the hook's scope stamp test is not %s: update scopeMsPattern to the hook's spelling", want)
	}
}
