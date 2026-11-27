package kernel

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func lines(t *testing.T, name string) []string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
}

// Every case line, read as jq reads it and printed in each mode, is byte for byte what real jq printed
// (testdata/gen-jq-golden.sh; the jq in jq-version.txt).
func TestJQGoldens(t *testing.T) {
	cases := append(lines(t, "jq-cases.json"), lines(t, "jq-cases-bytes.json")...)
	for _, m := range []struct {
		golden string
		enc    func(any) []byte
	}{{"jq-c.golden", JQCompact}, {"jq-cS.golden", JQCompactSorted}, {"jq-cSa.golden", JQCompactSortedASCII}} {
		want := lines(t, m.golden)
		if len(want) != len(cases) {
			t.Fatalf("%s has %d lines for %d cases: regenerate it", m.golden, len(want), len(cases))
		}
		for i, c := range cases {
			v, err := JQParse([]byte(c))
			if err != nil {
				t.Errorf("%s line %d: JQParse(%q) = %v, jq read it", m.golden, i+1, c, err)
				continue
			}
			if got := string(m.enc(v)); got != want[i] {
				t.Errorf("%s line %d (%q):\n got %s\nwant %s", m.golden, i+1, c, got, want[i])
			}
		}
	}
}

// A high surrogate escape with no low one after it is a parse error in jq, where encoding/json reads U+FFFD.
func TestJQParseRefusesWhatJQRefuses(t *testing.T) {
	for _, c := range lines(t, "jq-refused.json") {
		if v, err := JQParse([]byte(c)); err == nil {
			t.Errorf("JQParse(%s) = %#v, jq refuses it", c, v)
		}
	}
	for _, c := range []string{``, `1 2`, `{"a":1`, `[1,]`, "\"a\x01b\""} {
		if _, err := JQParse([]byte(c)); err == nil {
			t.Errorf("JQParse(%q) read a value", c)
		}
	}
}

// Go values the hook builds itself: an int prints as jq prints an integer literal, a []string as an array of strings.
func TestJQCompactGoValues(t *testing.T) {
	v := Obj{{K: "v", V: 1}, {K: "pid", V: int64(-4242)}, {K: "ms", V: 1764000000123}, {K: "ask", V: nil},
		{K: "subagents", V: []string{"b", "a"}}, {K: "ok", V: true}, {K: "n", V: json.Number("1E+2")},
		{K: "bad", V: "\xe2\x82"}, {K: "list", V: []any{Obj{}, []any{}}}}
	want := `{"v":1,"pid":-4242,"ms":1764000000123,"ask":null,"subagents":["b","a"],"ok":true,"n":1E+2,"bad":"` +
		string(rune(0xFFFD)) + `","list":[{},[]]}`
	if got := string(JQCompact(v)); got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	for _, bad := range []any{map[string]any{"a": 1}, float32(1), struct{}{}, uint(1)} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("JQCompact(%#v) did not panic: a type outside the closed set has no jq spelling here", bad)
				}
			}()
			JQCompact(bad)
		}()
	}
}

// The approval digest's vectors (server/test/fixtures/approvals/digest-corpus.json, read where it lives): the hook's
// APPROVAL_DIGEST_JQ walk (integers of magnitude at most 2^53-1, -0 as 0, anything else no digest) then `jq -cSa` over
// [session_id, agent_id // "", tool_name, cwd, tool_input] is each row's canonical, the bytes
// shared/api.ts#approvalDigestBytes recomputes.
func TestJQCompactSortedASCIIDigestCorpus(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "server", "test", "fixtures", "approvals", "digest-corpus.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Rows []struct{ Name, InputText, Canonical string }
	}
	if err := json.Unmarshal(b, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Rows) < 10 {
		t.Fatalf("the corpus has %d rows", len(corpus.Rows))
	}
	for _, row := range corpus.Rows {
		v, err := JQParse([]byte(row.InputText))
		if err != nil {
			t.Fatalf("%s: %v", row.Name, err)
		}
		got := "none"
		if w, ok := digestWalk(v); ok {
			in := w.(Obj)
			aid := field(in, "agent_id")
			if aid == nil || aid == false {
				aid = ""
			}
			got = string(JQCompactSortedASCII([]any{field(in, "session_id"), aid, field(in, "tool_name"), field(in, "cwd"), field(in, "tool_input")}))
		}
		if got != row.Canonical {
			t.Errorf("%s:\n got %s\nwant %s", row.Name, got, row.Canonical)
		}
	}
}

func field(o Obj, k string) any {
	for _, kv := range o {
		if kv.K == k {
			return kv.V
		}
	}
	return nil
}

func digestWalk(v any) (any, bool) {
	switch v := v.(type) {
	case json.Number:
		f, err := strconv.ParseFloat(string(v), 64)
		if err != nil || f != math.Floor(f) || math.Abs(f) > 9007199254740991 {
			return nil, false
		}
		return int64(f), true
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			y, ok := digestWalk(x)
			if !ok {
				return nil, false
			}
			out[i] = y
		}
		return out, true
	case Obj:
		out := make(Obj, len(v))
		for i, kv := range v {
			y, ok := digestWalk(kv.V)
			if !ok {
				return nil, false
			}
			out[i] = KV{K: kv.K, V: y}
		}
		return out, true
	}
	return v, true
}

// A number jq computed prints as jq prints it (testdata/jq-double.golden, from `. * 1` over jq-double-cases.txt).
func TestJQDoubleGolden(t *testing.T) {
	cases, want := lines(t, "jq-double-cases.txt"), lines(t, "jq-double.golden")
	if len(cases) != len(want) {
		t.Fatalf("%d cases, %d golden lines: regenerate", len(cases), len(want))
	}
	for i, c := range cases {
		x, _ := strconv.ParseFloat(c, 64) // 1e1000 reads as +Inf, as jq reads it
		if got := string(JQCompact(x)); got != want[i] {
			t.Errorf("%s: got %s, jq printed %s", c, got, want[i])
		}
	}
	if JQDouble(math.NaN()) != "null" {
		t.Error("NaN is null in jq")
	}
}

// JQParseFirst takes the first value and leaves the rest, as a reader of a jq program's first lines does.
func TestJQParseFirst(t *testing.T) {
	v, err := JQParseFirst([]byte(`{"state":"done"} {"state":"x"} garbage`))
	if err != nil || string(JQCompact(v)) != `{"state":"done"}` {
		t.Errorf("got %v %v", v, err)
	}
	if _, err := JQParseFirst([]byte("  ")); err == nil {
		t.Error("an empty input has no first value")
	}
}

// JQParseAll reads inputs as jq does: each value in turn, and at a value that does not parse, those before it and the error.
func TestJQParseAll(t *testing.T) {
	vs, err := JQParseAll([]byte(" {\"a\":1}{\"b\":2}\n[3] 4 "))
	if err != nil || len(vs) != 4 || string(JQCompact(vs[3])) != "4" {
		t.Errorf("got %v %v", vs, err)
	}
	vs, err = JQParseAll([]byte("{\"a\":1} garbage"))
	if err == nil || len(vs) != 1 {
		t.Errorf("trailing garbage: %v %v", vs, err)
	}
	if vs, err := JQParseAll([]byte(" \n")); err != nil || len(vs) != 0 {
		t.Errorf("no input: %v %v", vs, err)
	}
}

// The number lexicon: every spelling of testdata/jq-numbers.txt, bare, in an array and in an object, is read as real jq
// reads it (jq 1.7 and 1.8.1 answered alike) and printed byte for byte as jq prints it (gen-jq-numbers.sh). A spelling jq
// refuses is refused; one it reads is read (`nan`, `Infinity`, `01`, `+1`, `.5`, `1.`), which a hook that took it for
// "no payload" would let through what the bash denies.
func TestJQNumberLexicon(t *testing.T) {
	for _, l := range lines(t, "jq-numbers.golden") {
		f := strings.Split(l, "\t")
		if len(f) != 4 {
			t.Fatalf("bad golden line %q", l)
		}
		for i, text := range []string{f[0], "[" + f[0] + "]", `{"a":` + f[0] + `}`} {
			v, err := JQParse([]byte(text))
			switch want := f[i+1]; {
			case want == "REFUSED" && err == nil:
				t.Errorf("%q: jq refuses it, JQParse read %#v", text, v)
			case want != "REFUSED" && err != nil:
				t.Errorf("%q: jq reads it (%s), JQParse: %v", text, want, err)
			case want != "REFUSED" && string(JQCompact(v)) != want:
				t.Errorf("%q: got %s, jq prints %s", text, JQCompact(v), want)
			}
		}
	}
}
