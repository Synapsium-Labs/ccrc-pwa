package attention

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"ccrc/core/internal/kernel"
)

// The two Oniguruma programs of the merge, account, child, quiz, prune and build denies, held to what real jq printed for
// each (testdata/gen-guard-golden.sh) over every payload of testdata/guard-cases.jsonl: the suites' own payloads, their
// fixture corpora, hand rows from the residual lists and a seeded walk.

// guardOut is a golden line: `[<the output>]` as JSON, or ERR where jq failed.
func guardOut(out string, ok bool) string {
	if !ok {
		return "ERR"
	}
	return string(kernel.JQCompact([]any{out}))
}

func guardCases(t *testing.T) []any {
	t.Helper()
	var vs []any
	for _, l := range readLinesFile(t, "guard-cases.jsonl") {
		v, err := kernel.JQParse([]byte(l))
		if err != nil {
			t.Fatalf("%s: %v", l, err)
		}
		vs = append(vs, v)
	}
	return vs
}

func checkGolden(t *testing.T, name string, cases []any, f func(v any) (string, bool)) {
	t.Helper()
	want := readLinesFile(t, name)
	if len(want) != len(cases) {
		t.Fatalf("%s: %d lines for %d cases: regenerate", name, len(want), len(cases))
	}
	bad, stricter := 0, 0
	for i, v := range cases {
		if got := guardOut(f(v)); got != want[i] {
			if retryStricter(v, got) {
				stricter++ // onigRetryRisk's deny where jq answered (D-TBD-go-hook-onig-retry-limit's stricter side)
				continue
			}
			bad++
			if bad <= 25 {
				t.Errorf("%s case %d: got %s want %s\n  %s", name, i+1, got, want[i], kernel.JQCompact(v))
			}
		}
	}
	if bad > 25 {
		t.Errorf("%s: %d cases differ", name, bad)
	}
	if stricter > 0 {
		t.Logf("%s: %d cases denied by the retry estimate where jq answered", name, stricter)
	}
}

// retryStricter: Go's answer is pmglob's deny, and the command holds a glob word onigRetryRisk fires on, so the
// difference is the predicate's stricter side, which the ruling allows. Nothing else is.
func retryStricter(v any, got string) bool {
	if !strings.Contains(got, "a glob under ~/.ccrc that can match the private store or its journal") {
		return false
	}
	cmd, _ := get(v, "tool_input", "command").(string)
	for _, c := range []string{cmd, norm(cmd)} {
		for _, seg := range segSplit(c) {
			for _, g := range pmglobWords(seg) {
				if onigRetryRisk(g) {
					return true
				}
			}
		}
	}
	return false
}

func TestMergeStripGolden(t *testing.T) {
	checkGolden(t, "guard-strip.golden", guardCases(t), MergeStrip)
}

// The goldens are only as current as the programs they were measured from.
func TestGuardProgramsPinned(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("no node")
	}
	hook := filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh")
	want := readLinesFile(t, "guard-programs.sha256")
	for i, name := range []string{"MERGE_STRIP_JQ", "APPROVAL_FORBIDDEN_JQ", "ALLOW_ADMIN_RE"} {
		out, err := exec.Command(node, filepath.Join("testdata", "cut-hook-assign.mjs"), hook, name).Output()
		if err != nil {
			t.Fatal(err)
		}
		if got := fmt.Sprintf("%x", sha256.Sum256(out)); got != strings.TrimSpace(want[i]) {
			t.Errorf("%s changed (sha256 %s, the goldens were measured from %s): run testdata/gen-guard-golden.sh with real jq "+
				"and make the Go port match the new goldens", name, got, want[i])
		}
		if name == "ALLOW_ADMIN_RE" && string(out) != AllowAdminRE {
			t.Errorf("ALLOW_ADMIN_RE: Go %q, bash %q", AllowAdminRE, out)
		}
	}
	if _, err := os.Stat(hook); err != nil {
		t.Fatal(err)
	}
}

func readDenyFile(t *testing.T, name string) *string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b) // the file's text as the hook reads it, its last newline kept
	return &s
}

func TestForbiddenGolden(t *testing.T) {
	cases := guardCases(t)
	home := "/home/u"
	denyC, denyU := readDenyFile(t, "guard-deny-c.json"), readDenyFile(t, "guard-deny-u.json")
	for _, c := range []struct {
		golden, mode string
		deny         *string
	}{{"guard-class.golden", "class", nil}, {"guard-account.golden", "account", nil}, {"guard-deny.golden", "deny", nil},
		{"guard-denyc.golden", "deny", denyC}, {"guard-denyu.golden", "deny", denyU}} {
		t.Run(c.golden, func(t *testing.T) {
			checkGolden(t, c.golden, cases, func(v any) (string, bool) { return Forbidden(v, c.mode, c.deny, &home) })
		})
	}
}

// pmglob's pattern: g2re's text, and Oniguruma's answer for each of the five names (or its refusal), over a bracket-heavy
// corpus of glob words.
func TestPmglobGolden(t *testing.T) {
	checkGlobGolden(t, "guard-globs.jsonl", "guard-globs.golden")
}

// The retry-limit sweep (task 5 review F9): every word jq errors on (Oniguruma's retry limit, which pmglob's `catch
// true` reads as a match) is one onigRetryRisk fires on, and the words around the boundary that jq answers are held as
// the glob golden holds them.
func TestPmglobRetryGolden(t *testing.T) {
	n := checkGlobGolden(t, "guard-retry.jsonl", "guard-retry.golden")
	if n.jqErr < 5000 {
		t.Errorf("the sweep no longer measures the boundary: %d errors", n.jqErr)
	}
	// the stricter words, listed: a change in the predicate or the sweep is a reviewed change of this file
	// (GUARD_UPDATE=1 rewrites it)
	got := strings.Join(n.stricterWords, "\n") + "\n"
	p := filepath.Join("testdata", "guard-retry-stricter.jsonl")
	if os.Getenv("GUARD_UPDATE") == "1" {
		if err := os.WriteFile(p, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != got {
		t.Errorf("the words the retry estimate denies where jq answers changed (%d now): review them, then GUARD_UPDATE=1", len(n.stricterWords))
	}
	t.Logf("%d words, %d jq errors, %d denied by the estimate where jq answers, 0 allowed where jq denies", n.words, n.jqErr, len(n.stricterWords))
}

// globStricter are the words Go refuses and jq reads (a deny where bash allows), each a recorded D-TBD.
var globStricter = map[string]string{
	"[[:a:b:{?,operator}{[,l}[]@-?][:^x:]": "D-TBD-go-hook-glob-malformed-class (review round 1, F10)",
}

type globCounts struct {
	words, jqErr, stricter int
	stricterWords          []string // the stricter words, as JSON lines
}

// checkGlobGolden holds pmglob's pattern to jq word by word: g2re's text, and the five answers. Where onigRetryRisk
// fires, Go's answer is an err for every name (the pattern can match), which must cover every err jq gave; elsewhere,
// and for every word but the recorded stricter ones, the answers are jq's.
func checkGlobGolden(t *testing.T, words, golden string) globCounts {
	t.Helper()
	gs, want := readLinesFile(t, words), readLinesFile(t, golden)
	if len(gs) != len(want) {
		t.Fatalf("%d globs, %d golden lines: regenerate", len(gs), len(want))
	}
	n := globCounts{words: len(gs)}
	bad := 0
	for i, l := range gs {
		v, err := kernel.JQParse([]byte(l))
		if err != nil {
			t.Fatal(err)
		}
		g := v.(string)
		r := g2re(g)
		got := []any{r}
		for _, name := range pmNames {
			m, e := onigGlob(r, name)
			switch {
			case e:
				got = append(got, "err")
			default:
				got = append(got, fmt.Sprint(m))
			}
		}
		gotS := string(kernel.JQCompact(got))
		jqErr := strings.Contains(want[i], `"err"`)
		if jqErr {
			n.jqErr++
		}
		switch {
		case onigRetryRisk(g):
			if !jqErr && !strings.Contains(want[i], `"true"`) { // jq answered no match: Go's deny is the stricter side
				n.stricter++
				n.stricterWords = append(n.stricterWords, l)
			}
			continue // Go answers err: a match, whatever jq's per-name answers
		case jqErr && !strings.Contains(gotS, `"err"`) && !strings.Contains(gotS, `"true"`):
			// jq's err is a match: an answer of no match here would allow where bash denies
		case gotS == want[i]:
			continue
		case globStricter[g] != "":
			n.stricter++
			continue
		}
		if bad++; bad <= 30 {
			t.Errorf("glob %s: got %s want %s", l, gotS, want[i])
		}
	}
	if bad > 0 {
		t.Errorf("%d of %d globs differ", bad, len(gs))
	}
	return n
}

// pnorm's `$ENV.HOME // "~"` with HOME unset, over the path rows.
func TestForbiddenNoHomeGolden(t *testing.T) {
	var cases []any
	for _, l := range readLinesFile(t, "guard-nohome-cases.jsonl") {
		v, err := kernel.JQParse([]byte(l))
		if err != nil {
			t.Fatal(err)
		}
		cases = append(cases, v)
	}
	checkGolden(t, "guard-nohome.golden", cases, func(v any) (string, bool) { return Forbidden(v, "deny", nil, nil) })
}

// The deny file's parse (`$ARGS.named.deny | try (fromjson | .permissions.deny | arrays | .[] | strings) catch empty`, then
// the upstream ids paired as install and update): each text of guard-deny-texts.jsonl over the golden script's commands.
func TestForbiddenDenyTextGolden(t *testing.T) {
	texts, want := readLinesFile(t, "guard-deny-texts.jsonl"), readLinesFile(t, "guard-denytext.golden")
	cmds := []string{"upx install", "~/.local/bin/upx update", "lane-q install", "x-y update", "claude update", "cp a ~/.local/bin/upx", "cp a ~/.local/bin/x-y"}
	if len(want) != len(texts)*len(cmds) {
		t.Fatalf("%d golden lines for %d texts: regenerate", len(want), len(texts))
	}
	home := "/home/u"
	for i, l := range texts {
		v, err := kernel.JQParse([]byte(l))
		if err != nil {
			t.Fatal(err)
		}
		d := v.(string)
		for k, c := range cmds {
			p := kernel.Obj{{K: "tool_name", V: "Bash"}, {K: "tool_input", V: kernel.Obj{{K: "command", V: c}}}}
			if got := guardOut(Forbidden(p, "deny", &d, &home)); got != want[i*len(cmds)+k] {
				t.Errorf("deny text %s, %q: got %s want %s", l, c, got, want[i*len(cmds)+k])
			}
		}
	}
}

// ifold is Oniguruma's case folding onto the two case-insensitive patterns' letters, as testdata/ifold.txt measured it:
// every code point jq matched against a piece, ifold folds onto that piece, and nothing else folds.
func TestIFoldMeasured(t *testing.T) {
	measured := map[rune]string{}
	for _, l := range readLinesFile(t, "ifold.txt") {
		p, cp, _ := strings.Cut(l, " ")
		v, err := kernel.JQParse([]byte(p))
		if err != nil {
			t.Fatal(err)
		}
		var r rune
		fmt.Sscan(cp, &r)
		piece := v.(string)
		f, ok := ifold(r)
		if !ok {
			f = string(r)
		}
		if strings.ToLower(f) != piece && f != piece {
			t.Errorf("U+%04X: jq matched %q, ifold gives %q", r, piece, f)
		}
		measured[r] = piece
	}
	for r := rune(0); r < 0x110000; r++ {
		if f, ok := ifold(r); ok && r > 127 && measured[r] != f {
			t.Errorf("U+%04X folds to %q, jq measured %q", r, f, measured[r])
		}
	}
	if len(measured) < 40 {
		t.Fatalf("the measured file is too small: %d", len(measured))
	}
}

// The mail hold's strip: what jq printed for `include "mail-hold"; mh_prep | MERGE_STRIP_JQ` against MergeStrip over the
// payload mh_prep made (guard-prep.jsonl, jq's own `-c` answer, which the Go hook asks jq for), case by case.
func TestMailHoldStripGolden(t *testing.T) {
	preps, want := readLinesFile(t, "guard-prep.jsonl"), readLinesFile(t, "guard-mhstrip.golden")
	if len(preps) != len(want) {
		t.Fatalf("%d prepped payloads, %d golden lines: regenerate", len(preps), len(want))
	}
	for i, l := range preps {
		got := "ERR"
		if l != "null" { // mh_prep failed: the hook's one jq fails with it
			v, ok := MailHoldPrep([]byte(l))
			if !ok {
				t.Fatalf("line %d: %s", i+1, l)
			}
			got = guardOut(MergeStrip(v))
		}
		if got != want[i] {
			t.Errorf("case %d: got %s want %s\n  %s", i+1, got, want[i], l)
		}
	}
}
